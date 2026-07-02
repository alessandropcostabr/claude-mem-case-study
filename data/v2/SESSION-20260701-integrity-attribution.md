# Session 2026-07-01/02 — data-integrity audit, attribution fixes, rider A/B (arc) snapshot

Working note tying together what the 01–02/jul session added to the v2 dataset. Prose detail lives
in `THREE-WAY-REGIMES.md` (§DATA-INTEGRITY AUDIT, §Attribution fixes, §RIDER A/B). This file is the
index + the fresh CSV snapshots.

## 1. Rider A/B (arc) — the C′ abstraction gap is prompt-driven, holds at n=7
`rider-ab-summary-20260702.csv` / `rider-ab-by-session-20260702.csv` (host = DarkStarII/.254, self-author):

| arm | regime | obs | sessions | pat+arch | % |
|---|---|---:|---:|---:|---:|
| incremental (control) | `C-prime` | 312 | 48 | 2 | **0.6%** |
| arc (treatment) | `C-prime-arc` | 29 | **7** | 19 | **65.5%** |

Down from 85.7% at n=3 (regression to the mean), still ~100× the incremental arm. The `.254` was flipped
to 100%-arc on 29/jun to accelerate the rare cell. Needs ~10-15 arc sessions for firm significance (at 7).

## 2. Data-integrity audit — self-author content loss = ZERO
Reconciled 1181 CC transcripts × PG. Findings (full detail in THREE-WAY-REGIMES.md §DATA-INTEGRITY):
- **Type-enum 400s (12): 100% self-healed** via retry — the invalid types were the *memory* taxonomy
  (`feedback`/`correction`/`project`/`reference`) confused with the *observation* enum. No content lost.
- **Valid-type transient-drop loss: 0/471** — the one obs that seemed lost (EADDRINUSE bugfix) actually
  landed as a no-regime/NULL-sid self-author obs. Net self-author content loss = **0**.
- The real defect is **attribution, not durability**: Stop obs and spontaneous saves land with NULL
  `content_session_id`.

## 3. Attribution — fixes + backfill
`regime-attribution-20260702.csv` (post-backfill state):

| regime | total | with_sid | backfilled | pat+arch | avg_chars |
|---|---:|---:|---:|---:|---:|
| B (pipeline) | 106,761 | 0 | 0 | 745 | 1169 |
| C (Stop) | 903 | 898 | 891 | 29 | 2295 |
| (untagged) | 581 | 212 | 212 | 42 | 1137 |
| C-prime | 313 | 313 | 1 | 2 | 2115 |
| C-prime-arc | 29 | 29 | 0 | 19 | 2196 |

Fixes deployed (worker `4b4c242b`, fleet 3/3):
- **Enum fix** (`d10f5f9f`) — rider + Stop prompts enumerate the 7 valid `type`s.
- **Stop `:stop`-attribution** (`0c98353f`) — Stop prompt carries `checkpoint_key="selfauthor:<sid>:stop"`
  → Stop obs get `content_session_id` + regime C. E2E-proven (POST → regime C + sid). Active on `.253`+`.100`.
- **Backfill** (2 rounds, title×transcript, reversible flag `content_session_id_backfilled`): **1104 obs**
  attributed. C(Stop) went from 895/895 NULL-sid to **5/896**; C-prime/C-prime-arc 100% attributed.
- Still open (carded): **spontaneous saves** (no hook/no key) — need the CC session id plumbed to the
  MCP/worker. Not loss; just untagged (the `(untagged)` bucket, already excluded from regime comparisons).

## 4. Fable 5 back → benchmark reactivated
Claude Fable 5 (Mythos-class) returned; `.100` updated to CC 2.1.198 (recognizes `claude-fable-5`). The Fable
benchmark cron (disabled 13/jun) was re-enabled + confirmed live (2.1.198, ~131s, $0.62/run). The
`benchmarks` series resumes including Fable alongside Opus 4.6/4.8/Haiku.
