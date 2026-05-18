#!/usr/bin/env python3
# OraClaw Cron Optimizer — Energy-Aware Schedule Optimization
"""
OraClaw Cron Optimizer — Energy-Aware Schedule Optimization
============================================================
Feedback loop automatizado:
  1. Coleta métricas reais de load (sistema + histórico)
  2. Classifica jobs por peso (CPU/IO/duração)
  3. Resolve scheduling ótimo (priority-weighted energy matching)
  4. Aplica crontab otimizado com backup + ntfy

Algoritmo: solve_schedule (mesma lógica do OraClaw MCP tool)
  - Tasks: jobs pesados com priority, duration, energyRequired
  - Slots: janelas horárias com energyLevel baseado em load real

Substitui: oraclaw-schedule.py (greedy bin-packing, sem métricas reais)

Cron: 0 4 * * 0 /usr/bin/python3 ~/workspace/scripts/oraclaw-cron-optimizer.py --apply
Uso:  python3 oraclaw-cron-optimizer.py [--apply] [--dry-run] [--json] [--verbose]
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPORT_PATH = Path.home() / 'workspace/learn/cron-optimizer-report.json'
BACKUP_DIR = Path.home() / 'workspace/learn/cron-backups'
ENV_FLEET = Path.home() / '.claude-mem/.env-fleet'
MAX_BACKUPS = 10
NUM_CORES = os.cpu_count() or 4
VERBOSE = '--verbose' in sys.argv

# Energy thresholds (load average / num_cores)
ENERGY_HIGH_THRESHOLD = 0.3   # < 30% utilization = high energy available
ENERGY_LOW_THRESHOLD = 0.7    # > 70% utilization = low energy available

# Work hours: user actively working, prefer not to run heavy jobs
WORK_HOURS_START = 9
WORK_HOURS_END = 19

LOG_PREFIX = lambda: f'[{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}]'


def log(msg: str) -> None:
    print(f'{LOG_PREFIX()} {msg}')


def vlog(msg: str) -> None:
    if VERBOSE:
        log(f'  [v] {msg}')


# ---------------------------------------------------------------------------
# Job metadata: classification by pattern
# ---------------------------------------------------------------------------

JOB_PROFILES: list[dict] = [
    # pattern, duration_min, priority (1-10), energy_required
    {'pat': r'learn-conv-analyze-v3',  'dur': 11, 'pri': 9, 'energy': 'high', 'label': 'conv-analyze'},
    {'pat': r'learn-calls-analyze-v3', 'dur': 15, 'pri': 8, 'energy': 'high', 'label': 'calls-analyze'},
    {'pat': r'learn-build-index',      'dur': 25, 'pri': 8, 'energy': 'high', 'label': 'build-index'},
    {'pat': r'learn-b2b-self-refl',    'dur': 15, 'pri': 7, 'energy': 'high', 'label': 'self-reflect-b2b'},
    {'pat': r'learn-calls-self-refl',  'dur': 15, 'pri': 7, 'energy': 'high', 'label': 'self-reflect-calls'},
    {'pat': r'learn-ingest',           'dur': 10, 'pri': 9, 'energy': 'high', 'label': 'ingest'},
    {'pat': r'eval-runner|learn-eval', 'dur': 12, 'pri': 8, 'energy': 'high', 'label': 'eval'},
    {'pat': r'learn-retention',        'dur': 10, 'pri': 6, 'energy': 'medium', 'label': 'retention'},
    {'pat': r'late-study',             'dur': 20, 'pri': 5, 'energy': 'medium', 'label': 'late-study'},
    {'pat': r'orchestrator',           'dur': 15, 'pri': 7, 'energy': 'medium', 'label': 'orchestrator'},
    {'pat': r'consolidate-memory',     'dur': 10, 'pri': 4, 'energy': 'low',  'label': 'consolidate'},
    {'pat': r'llm-judge',              'dur': 10, 'pri': 5, 'energy': 'medium', 'label': 'llm-judge'},
    {'pat': r'openclaw-infer|openclaw-gateway', 'dur': 15, 'pri': 8, 'energy': 'high', 'label': 'openclaw'},
    {'pat': r'benchmark',              'dur': 10, 'pri': 3, 'energy': 'medium', 'label': 'benchmark'},
    {'pat': r'sync-documentos',        'dur': 5,  'pri': 4, 'energy': 'low',  'label': 'sync-docs'},
    {'pat': r'watch-calls-sentiment',  'dur': 8,  'pri': 5, 'energy': 'medium', 'label': 'sentiment'},
    {'pat': r'sync-jsonl-to-claude',   'dur': 5,  'pri': 4, 'energy': 'low',  'label': 'sync-jsonl'},
    {'pat': r'auto-patch-claude',      'dur': 3,  'pri': 2, 'energy': 'low',  'label': 'auto-patch'},
    {'pat': r'cortex-sync',            'dur': 5,  'pri': 3, 'energy': 'low',  'label': 'cortex-sync'},
]

# Pipeline chains: jobs that must stay sequential (relative order preserved)
PIPELINE_CHAINS: list[list[str]] = [
    ['learn-ingest', 'learn-eval', 'eval-runner', 'late-study'],
    ['learn-sync-late-pg', 'build-session-lookup', 'learn_sync_call_metrics'],
    ['learn-b2b-self-refl', 'learn-calls-self-refl'],
]

# Jobs that should NEVER be moved (watchdogs, pollers, real-time)
IMMOVABLE_PATTERNS: list[str] = [
    r'ensure-claude-tmux',
    r'reaction.poller',
    r'discord-reaction-poller',
    r'convert-recent-responses',
    r'oraclaw-late-health',
    r'late-b2b-briefing',
    r'@reboot',
]


def get_job_profile(cmd: str) -> dict | None:
    for profile in JOB_PROFILES:
        if re.search(profile['pat'], cmd, re.IGNORECASE):
            return profile
    return None


def is_immovable(cmd: str) -> bool:
    for pat in IMMOVABLE_PATTERNS:
        if re.search(pat, cmd, re.IGNORECASE):
            return True
    return False


def is_heavy(cmd: str) -> bool:
    profile = get_job_profile(cmd)
    return profile is not None and profile['energy'] == 'high'


# ---------------------------------------------------------------------------
# Load metrics collection
# ---------------------------------------------------------------------------

def get_current_load() -> dict:
    """Read /proc/loadavg for real-time system load."""
    try:
        with open('/proc/loadavg') as f:
            parts = f.read().split()
        return {
            'load_1m': float(parts[0]),
            'load_5m': float(parts[1]),
            'load_15m': float(parts[2]),
            'running_procs': int(parts[3].split('/')[0]),
            'total_procs': int(parts[3].split('/')[1]),
        }
    except (OSError, ValueError, IndexError):
        return {'load_1m': 0, 'load_5m': 0, 'load_15m': 0}


def get_historical_load() -> dict[int, float]:
    """
    Parse journal/sysstat for hourly load averages over past 7 days.
    Returns: {hour: avg_load_normalized} (0-23)
    Fallback: uses work-hours heuristic if no data available.
    """
    hourly_loads: dict[int, list[float]] = defaultdict(list)

    # Try sar data first (most accurate)
    try:
        result = subprocess.run(
            ['sar', '-q', '-f', '/var/log/sysstat/sa' + datetime.now().strftime('%d')],
            capture_output=True, text=True, timeout=10, check=False,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 5 and ':' in parts[0]:
                    try:
                        hour = int(parts[0].split(':')[0])
                        load = float(parts[4])  # ldavg-5
                        hourly_loads[hour].append(load / NUM_CORES)
                    except (ValueError, IndexError):
                        continue
    except (OSError, subprocess.TimeoutExpired):
        pass

    # Try previous report for cached energy data (only if it has differentiation)
    if not hourly_loads:
        history_file = REPORT_PATH
        if history_file.exists():
            try:
                prev = json.loads(history_file.read_text())
                if 'hourly_energy' in prev:
                    energy_map = {'high': 0.1, 'medium': 0.4, 'low': 0.8}
                    values = set(prev['hourly_energy'].values())
                    # Only trust if there's actual differentiation (not all same)
                    if len(values) >= 2:
                        for slot, energy in prev['hourly_energy'].items():
                            h = int(slot.split(':')[0])
                            hourly_loads[h] = [energy_map.get(energy, 0.5)]
            except (json.JSONDecodeError, KeyError):
                pass

    # Fallback: heuristic based on work hours + known patterns
    if not hourly_loads:
        vlog('No sar data — using work-hours heuristic')
        for h in range(24):
            if WORK_HOURS_START <= h < WORK_HOURS_END:
                hourly_loads[h] = [0.8]  # work hours = user active, low energy
            elif 0 <= h < 6 or h >= 22:
                hourly_loads[h] = [0.1]  # night = idle, high energy
            else:
                hourly_loads[h] = [0.4]  # morning/evening = medium

    return {h: sum(loads) / len(loads) for h, loads in hourly_loads.items()}


# ---------------------------------------------------------------------------
# Crontab parser (enhanced from oraclaw-schedule.py)
# ---------------------------------------------------------------------------

def parse_cron_field(field: str, lo: int, hi: int) -> list[int]:
    if field == '*':
        return list(range(lo, hi + 1))
    if field.startswith('*/'):
        step = int(field[2:])
        return list(range(lo, hi + 1, step))
    if ',' in field:
        return [int(x) for x in field.split(',')]
    if '-' in field:
        a, b = field.split('-', 1)
        return list(range(int(a), int(b) + 1))
    return [int(field)]


def parse_crontab() -> tuple[list[dict], str]:
    """Returns (parsed_jobs, raw_crontab_text)."""
    result = subprocess.run(
        ['crontab', '-l'], capture_output=True, text=True, timeout=5, check=False,
    )
    if result.returncode != 0:
        return [], ''

    raw = result.stdout
    jobs = []

    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or stripped.startswith('@'):
            continue
        if '=' in stripped and not stripped[0].isdigit() and stripped[0] != '*':
            continue

        parts = stripped.split(None, 5)
        if len(parts) < 6:
            continue

        minute, hour, dom, month, dow, cmd = parts
        if month != '*':
            continue

        try:
            minutes = parse_cron_field(minute, 0, 59)
            hours = parse_cron_field(hour, 0, 23)
        except ValueError:
            continue

        profile = get_job_profile(cmd)
        is_heavy_job = profile is not None and profile['energy'] == 'high'
        is_recurring = len(minutes) * len(hours) > 12

        jobs.append({
            'minute_field': minute,
            'hour_field': hour,
            'dom': dom,
            'month': month,
            'dow': dow,
            'cmd': cmd,
            'minutes': minutes,
            'hours': hours,
            'profile': profile,
            'is_heavy': is_heavy_job,
            'is_recurring': is_recurring,
            'is_immovable': is_immovable(cmd),
            'original_line': stripped,
        })

    return jobs, raw


# ---------------------------------------------------------------------------
# Solve Schedule: priority-weighted energy-matched assignment
# ---------------------------------------------------------------------------

def compute_slot_energy(hour: int, historical_load: dict[int, float]) -> str:
    """Determine energy level for a given hour based on real load data."""
    load_norm = historical_load.get(hour, 0.5)
    if load_norm < ENERGY_HIGH_THRESHOLD:
        return 'high'
    elif load_norm > ENERGY_LOW_THRESHOLD:
        return 'low'
    return 'medium'


def energy_match_score(task_energy: str, slot_energy: str) -> float:
    """Score multiplier for energy matching (0.2 to 1.0)."""
    matrix = {
        ('high', 'high'): 1.0,
        ('high', 'medium'): 0.5,
        ('high', 'low'): 0.2,
        ('medium', 'high'): 1.0,
        ('medium', 'medium'): 1.0,
        ('medium', 'low'): 0.6,
        ('low', 'high'): 1.0,
        ('low', 'medium'): 1.0,
        ('low', 'low'): 1.0,
    }
    return matrix.get((task_energy, slot_energy), 0.5)


def solve_schedule(tasks: list[dict], slots: list[dict]) -> list[dict]:
    """
    Priority-weighted energy-matched assignment.
    Same algorithm as OraClaw MCP solve_schedule tool.

    Greedy: sort tasks by priority desc, assign each to best available slot.
    Score = priority * energy_match_score.
    Constraint: one heavy task per slot (60min window).
    """
    # Sort tasks by priority descending (highest first gets best slots)
    sorted_tasks = sorted(tasks, key=lambda t: t['priority'], reverse=True)

    # Track slot usage
    slot_usage: dict[str, int] = defaultdict(int)  # slot_id → minutes used
    slot_heavy: dict[str, bool] = defaultdict(bool)  # slot_id → has heavy task

    assignments = []

    for task in sorted_tasks:
        best_slot = None
        best_score = -1

        for slot in slots:
            # Skip if slot is full
            remaining = slot['duration_minutes'] - slot_usage[slot['id']]
            if remaining < task['duration_minutes']:
                continue
            # Skip if slot already has a heavy task and this is heavy
            if task['energy_required'] == 'high' and slot_heavy[slot['id']]:
                continue

            score = task['priority'] * energy_match_score(
                task['energy_required'], slot['energy_level']
            )

            if score > best_score:
                best_score = score
                best_slot = slot

        if best_slot:
            assignments.append({
                'task_id': task['id'],
                'task_name': task['name'],
                'slot_id': best_slot['id'],
                'slot_hour': best_slot['start_hour'],
                'score': best_score,
            })
            slot_usage[best_slot['id']] += task['duration_minutes']
            if task['energy_required'] == 'high':
                slot_heavy[best_slot['id']] = True

    return assignments


# ---------------------------------------------------------------------------
# Conflict detection: find stampedes and overloaded windows
# ---------------------------------------------------------------------------

def detect_conflicts(jobs: list[dict]) -> list[dict]:
    """Identify scheduling conflicts worth fixing."""
    conflicts = []

    # 1. Stampede detection: multiple INDEPENDENT heavy jobs at same minute (or <5min gap)
    heavy_by_window: dict[str, list[dict]] = defaultdict(list)
    for job in jobs:
        if not job['is_heavy'] or job['is_recurring'] or job['is_immovable']:
            continue
        for h in job['hours']:
            for m in job['minutes']:
                window = f'{h:02d}:{(m // 15) * 15:02d}'
                heavy_by_window[window].append(job)

    for window, window_jobs in heavy_by_window.items():
        # Filter: only flag if jobs are from DIFFERENT pipelines (same pipeline = expected)
        pipelines = set()
        independent_count = 0
        for j in window_jobs:
            chain = get_pipeline_group(j['cmd'])
            if chain:
                pipelines.add(chain)
            else:
                independent_count += 1
        # Conflict: 2+ different pipelines, or independent heavy + pipeline
        if len(pipelines) + independent_count >= 2 and len(window_jobs) >= 2:
            conflicts.append({
                'type': 'stampede',
                'window': window,
                'count': len(window_jobs),
                'jobs': [j['profile']['label'] if j['profile'] else j['cmd'][:40]
                         for j in window_jobs],
            })

    # 2. Work-hours violation: heavy jobs during 09-19h
    for job in jobs:
        if not job['is_heavy'] or job['is_recurring'] or job['is_immovable']:
            continue
        for h in job['hours']:
            if WORK_HOURS_START <= h < WORK_HOURS_END:
                conflicts.append({
                    'type': 'work_hours_violation',
                    'hour': h,
                    'job': job['profile']['label'] if job['profile'] else job['cmd'][:40],
                    'original': job['original_line'][:80],
                })

    # 3. Recurring jobs all firing at :00/:30 (stampede)
    recurring_at_zero: list[dict] = []
    for job in jobs:
        if not job['is_recurring'] or job['is_immovable']:
            continue
        if job['minutes'] and all(m % 30 == 0 for m in job['minutes'][:2]):
            profile = get_job_profile(job['cmd'])
            if profile and profile['energy'] in ('high', 'medium'):
                recurring_at_zero.append(job)

    if len(recurring_at_zero) >= 3:
        conflicts.append({
            'type': 'recurring_stampede',
            'count': len(recurring_at_zero),
            'jobs': [j['profile']['label'] if j['profile'] else j['cmd'][:40]
                     for j in recurring_at_zero],
        })

    return conflicts


# ---------------------------------------------------------------------------
# Generate optimized schedule
# ---------------------------------------------------------------------------

def get_pipeline_group(cmd: str) -> str | None:
    """If this job is part of a pipeline, return the chain ID."""
    for i, chain in enumerate(PIPELINE_CHAINS):
        for keyword in chain:
            if re.search(keyword, cmd, re.IGNORECASE):
                return f'chain_{i}'
    return None


def optimize(jobs: list[dict], historical_load: dict[int, float]) -> list[dict]:
    """
    Run solve_schedule on movable heavy jobs.
    Returns list of changes: [{original_line, new_line, reason}]

    Pipeline constraint: jobs in same pipeline chain stay in same hour
    (solver assigns the chain as a group, not individual jobs).
    """
    # Identify conflicted jobs (stampede or work-hours violation)
    conflicted_jobs = []
    for job in jobs:
        if job['is_immovable'] or job['is_recurring']:
            continue
        profile = job['profile']
        if not profile or profile['energy'] == 'low':
            continue

        in_conflict = False
        for h in job['hours']:
            if WORK_HOURS_START <= h < WORK_HOURS_END and profile['energy'] == 'high':
                in_conflict = True
                break
        if not in_conflict:
            for h in job['hours']:
                for m in job['minutes']:
                    count = sum(
                        1 for j in jobs
                        if j['is_heavy'] and not j['is_recurring'] and not j['is_immovable']
                        and any(hh == h for hh in j['hours'])
                        and any(abs(mm - m) < 30 for mm in j['minutes'])
                    )
                    if count >= 3:  # threshold: 3+ heavy in same window
                        in_conflict = True
                        break
                if in_conflict:
                    break

        if in_conflict:
            conflicted_jobs.append(job)

    if not conflicted_jobs:
        return []

    # Group pipeline jobs: treat each pipeline as a single task for the solver
    pipeline_groups: dict[str, list[dict]] = defaultdict(list)
    standalone_tasks = []

    for job in conflicted_jobs:
        chain_id = get_pipeline_group(job['cmd'])
        if chain_id:
            pipeline_groups[chain_id].append(job)
        else:
            standalone_tasks.append(job)

    # Build solver tasks
    tasks = []
    for job in standalone_tasks:
        profile = job['profile']
        tasks.append({
            'id': f'{profile["label"]}_{job["hour_field"]}_{job["minute_field"]}',
            'name': profile['label'],
            'duration_minutes': profile['dur'],
            'priority': profile['pri'],
            'energy_required': profile['energy'],
            '_jobs': [job],
            '_is_pipeline': False,
        })

    for chain_id, chain_jobs in pipeline_groups.items():
        total_dur = sum(j['profile']['dur'] for j in chain_jobs if j['profile'])
        max_pri = max(j['profile']['pri'] for j in chain_jobs if j['profile'])
        label = chain_jobs[0]['profile']['label'] if chain_jobs[0]['profile'] else 'pipeline'
        tasks.append({
            'id': f'pipeline_{chain_id}',
            'name': f'{label}-chain ({len(chain_jobs)} jobs)',
            'duration_minutes': total_dur,
            'priority': max_pri,
            'energy_required': 'high',
            '_jobs': chain_jobs,
            '_is_pipeline': True,
        })

    # Build slots (24 hours with energy from real data)
    slots = []
    for h in range(24):
        energy = compute_slot_energy(h, historical_load)
        slots.append({
            'id': f'{h:02d}:00',
            'start_hour': h,
            'duration_minutes': 60,
            'energy_level': energy,
        })

    vlog(f'Solving: {len(tasks)} tasks ({sum(1 for t in tasks if t["_is_pipeline"])} pipelines), {len(slots)} slots')
    vlog(f'Slot energy: ' + ' '.join(
        f'{h:02d}={compute_slot_energy(h, historical_load)[0].upper()}'
        for h in range(24)
    ))

    # Solve
    assignments = solve_schedule(tasks, slots)

    # Generate changes
    changes = []
    for assignment in assignments:
        task = next(t for t in tasks if t['id'] == assignment['task_id'])
        new_hour = assignment['slot_hour']

        for i, job in enumerate(task['_jobs']):
            # Skip if already in the assigned slot
            if new_hour in job['hours'] and not task['_is_pipeline']:
                continue

            # Pipeline: keep sequential within the hour (5min spacing)
            if task['_is_pipeline']:
                new_minute = job['minutes'][0] if new_hour in job['hours'] else (i * 5)
                # If already in correct hour, skip
                if new_hour in job['hours']:
                    continue
            else:
                existing = sum(
                    1 for a in assignments
                    if a['slot_hour'] == new_hour and a['task_id'] != task['id']
                )
                new_minute = min(existing * 15 + i * 5, 55)

            parts = job['original_line'].split(None, 5)
            if len(parts) < 6:
                continue

            # Handle multi-hour fields (e.g., "2,8,14,22")
            # For multi-hour: only change hours, KEEP original minute (preserves spacing)
            if ',' in job['hour_field']:
                old_hours = [int(h) for h in job['hour_field'].split(',')]
                new_hours = []
                for oh in old_hours:
                    if WORK_HOURS_START <= oh < WORK_HOURS_END:
                        if new_hour not in new_hours:
                            new_hours.append(new_hour)
                    else:
                        new_hours.append(oh)
                new_hours = sorted(set(new_hours))
                new_hour_field = ','.join(str(h) for h in new_hours)
                # Preserve original minute for multi-hour entries
                new_minute = int(parts[0])
            else:
                new_hour_field = str(new_hour)

            new_line = f'{new_minute} {new_hour_field} {parts[2]} {parts[3]} {parts[4]} {parts[5]}'

            if new_line.strip() == job['original_line'].strip():
                continue

            changes.append({
                'original_line': job['original_line'],
                'new_line': new_line,
                'reason': (
                    f'{task["name"]}: moved to {new_hour:02d}:{new_minute:02d} '
                    f'(score {assignment["score"]:.1f}, '
                    f'slot energy={compute_slot_energy(new_hour, historical_load)})'
                ),
            })

    return changes


# ---------------------------------------------------------------------------
# Pipeline-aware: redistribute stampeded pipelines
# ---------------------------------------------------------------------------

def optimize_pipelines(jobs: list[dict], historical_load: dict[int, float]) -> list[dict]:
    """
    For pipeline chains (ingest→eval→study), ensure minimum gap between members.
    Returns additional changes if pipeline jobs are too tightly packed.

    Only flags gaps between DIFFERENT jobs (not same job at different hours).
    Minimum acceptable gap: 5 minutes.
    """
    changes = []
    seen_lines = set()

    for chain in PIPELINE_CHAINS:
        chain_jobs = []
        for keyword in chain:
            matching = [
                j for j in jobs
                if not j['is_immovable'] and re.search(keyword, j['cmd'], re.IGNORECASE)
                and not j['is_recurring']
            ]
            chain_jobs.extend(matching)

        if len(chain_jobs) < 2:
            continue

        # Only check jobs in the same hour (pipeline members should be in same hour block)
        by_hour: dict[int, list[tuple[int, dict]]] = defaultdict(list)
        for j in chain_jobs:
            for h in j['hours']:
                for m in j['minutes']:
                    by_hour[h].append((m, j))

        for hour, entries in by_hour.items():
            entries.sort(key=lambda x: x[0])
            for i in range(1, len(entries)):
                gap = entries[i][0] - entries[i - 1][0]
                # Only flag if gap < 5 AND these are different cron lines
                if gap < 5 and entries[i][1]['original_line'] != entries[i - 1][1]['original_line']:
                    job = entries[i][1]
                    if job['original_line'] in seen_lines:
                        continue
                    seen_lines.add(job['original_line'])

                    profile = job['profile']
                    if not profile:
                        continue

                    new_min = min(entries[i - 1][0] + 5, 55)
                    parts = job['original_line'].split(None, 5)
                    if len(parts) < 6:
                        continue

                    new_line = f'{new_min} {parts[1]} {parts[2]} {parts[3]} {parts[4]} {parts[5]}'
                    if new_line.strip() != job['original_line'].strip():
                        changes.append({
                            'original_line': job['original_line'],
                            'new_line': new_line,
                            'reason': f'pipeline gap: {gap}min → 5min (avoid I/O thrashing)',
                        })

    return changes


# ---------------------------------------------------------------------------
# Apply changes
# ---------------------------------------------------------------------------

def apply_changes(raw_crontab: str, changes: list[dict], dry_run: bool = False) -> bool:
    """Apply changes to crontab with backup and validation."""
    if not changes:
        log('  Nenhuma mudanca necessaria')
        return True

    # Backup
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    bak_path = BACKUP_DIR / f'crontab.{datetime.now().strftime("%Y%m%d-%H%M%S")}.bak'
    bak_path.write_text(raw_crontab)
    log(f'  Backup: {bak_path}')

    # Prune old backups
    backups = sorted(BACKUP_DIR.glob('crontab.*.bak'), key=lambda p: p.stat().st_mtime)
    for old in backups[:-MAX_BACKUPS]:
        old.unlink()

    if dry_run:
        log('  [DRY-RUN] Mudancas que seriam aplicadas:')
        for c in changes:
            log(f'    - {c["original_line"][:70]}')
            log(f'    + {c["new_line"][:70]}')
            log(f'      ({c["reason"]})')
        return True

    # Apply
    new_crontab = raw_crontab
    applied_count = 0
    for c in changes:
        if c['original_line'] in new_crontab:
            new_crontab = new_crontab.replace(c['original_line'], c['new_line'], 1)
            applied_count += 1
        else:
            log(f'  AVISO: linha nao encontrada (skip): {c["original_line"][:60]}')

    if applied_count == 0:
        log('  Nenhuma linha substituida (todas ja atualizadas?)')
        return False

    result = subprocess.run(
        ['crontab', '-'],
        input=new_crontab, text=True, capture_output=True, timeout=10, check=False,
    )
    if result.returncode != 0:
        log(f'  ERRO ao aplicar: {result.stderr.strip()[:120]}')
        log(f'  Restaurando backup...')
        subprocess.run(['crontab', '-'], input=raw_crontab, text=True, timeout=10)
        return False

    # Validate
    verify = subprocess.run(['crontab', '-l'], capture_output=True, text=True, timeout=5)
    verified = sum(1 for c in changes if c['new_line'] in verify.stdout)
    log(f'  Aplicado: {verified}/{applied_count} mudanca(s) verificada(s)')

    return verified > 0


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

def send_ntfy(title: str, body: str, priority: str = 'default') -> None:
    """Send notification via ntfy using .env-fleet config."""
    env = _load_env_fleet()
    url = env.get('NTFY_URL', '')
    topic = env.get('NTFY_TOPIC', '')
    token = env.get('NTFY_TOKEN', '')

    if not url or not topic:
        vlog('ntfy not configured (missing NTFY_URL/NTFY_TOPIC in .env-fleet)')
        return

    headers = [
        '-H', f'Title: {title}',
        '-H', f'Priority: {priority}',
        '-H', 'Tags: gear,clock',
    ]
    if token:
        headers += ['-H', f'Authorization: Bearer {token}']

    try:
        subprocess.run(
            ['curl', '-s', '-d', body, *headers, f'{url}/{topic}'],
            capture_output=True, timeout=10, check=False,
        )
        vlog(f'ntfy sent: {title}')
    except (OSError, subprocess.TimeoutExpired):
        pass


def _load_env_fleet() -> dict[str, str]:
    """Parse .env-fleet file."""
    env = {}
    if not ENV_FLEET.exists():
        return env
    for line in ENV_FLEET.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' in line:
            key, val = line.split('=', 1)
            env[key.strip()] = val.strip().strip('"').strip("'")
    return env


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def generate_report(
    jobs: list[dict],
    conflicts: list[dict],
    changes: list[dict],
    load_data: dict,
    historical_load: dict[int, float],
) -> dict:
    report = {
        'generated_at': datetime.now().isoformat(),
        'machine': os.uname().nodename,
        'cores': NUM_CORES,
        'current_load': load_data,
        'hourly_energy': {
            f'{h:02d}:00': compute_slot_energy(h, historical_load)
            for h in range(24)
        },
        'total_jobs': len(jobs),
        'heavy_jobs': sum(1 for j in jobs if j['is_heavy']),
        'conflicts_found': len(conflicts),
        'conflicts': conflicts,
        'changes_applied': len(changes),
        'changes': [
            {'from': c['original_line'][:80], 'to': c['new_line'][:80], 'reason': c['reason']}
            for c in changes
        ],
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    return report


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run() -> None:
    log('=== OraClaw Cron Optimizer (energy-aware) ===')

    # 1. Collect metrics
    load_data = get_current_load()
    log(f'  Load atual: {load_data["load_1m"]:.2f} / {load_data["load_5m"]:.2f} / {load_data["load_15m"]:.2f} ({NUM_CORES} cores)')

    historical_load = get_historical_load()
    high_energy_hours = [h for h in range(24) if compute_slot_energy(h, historical_load) == 'high']
    log(f'  Slots high-energy: {", ".join(f"{h:02d}h" for h in high_energy_hours)}')

    # 2. Parse crontab
    jobs, raw_crontab = parse_crontab()
    if not jobs:
        log('  ERRO: nenhum job encontrado')
        return

    heavy_count = sum(1 for j in jobs if j['is_heavy'])
    log(f'  Jobs: {len(jobs)} total, {heavy_count} pesados')

    # 3. Detect conflicts
    conflicts = detect_conflicts(jobs)
    if not conflicts:
        log('  Nenhum conflito detectado — crontab otimo')
        generate_report(jobs, conflicts, [], load_data, historical_load)
        return

    log(f'  Conflitos: {len(conflicts)}')
    for c in conflicts:
        if c['type'] == 'stampede':
            log(f'    Stampede {c["window"]}: {c["count"]} heavy jobs ({", ".join(c["jobs"])})')
        elif c['type'] == 'work_hours_violation':
            log(f'    Work-hours: {c["job"]} at {c["hour"]:02d}h')
        elif c['type'] == 'recurring_stampede':
            log(f'    Recurring stampede: {c["count"]} jobs at :00/:30')

    # 4. Optimize
    changes = optimize(jobs, historical_load)
    pipeline_changes = optimize_pipelines(jobs, historical_load)

    # Merge (avoid duplicates)
    seen = set()
    all_changes = []
    for c in changes + pipeline_changes:
        if c['original_line'] not in seen:
            seen.add(c['original_line'])
            all_changes.append(c)

    if not all_changes:
        log('  Solver nao encontrou melhorias aplicaveis')
        generate_report(jobs, conflicts, [], load_data, historical_load)
        return

    log(f'  Solver: {len(all_changes)} mudanca(s) propostas')
    for c in all_changes:
        log(f'    {c["reason"]}')

    # 5. Apply or dry-run
    dry_run = '--dry-run' in sys.argv
    should_apply = '--apply' in sys.argv or '--dry-run' in sys.argv

    if should_apply:
        ok = apply_changes(raw_crontab, all_changes, dry_run=dry_run)
        if ok and not dry_run:
            send_ntfy(
                'OraClaw Cron Optimizer',
                f'{len(all_changes)} job(s) redistribuido(s)\n'
                f'Conflicts resolved: {len(conflicts)}\n'
                f'Machine: {os.uname().nodename}',
                priority='low',
            )
    else:
        log('  Use --apply para aplicar ou --dry-run para simular')

    # 6. Report
    report = generate_report(jobs, conflicts, all_changes, load_data, historical_load)
    log(f'  Relatorio: {REPORT_PATH}')
    log('=== Otimizador concluido ===')

    if '--json' in sys.argv:
        print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    run()
