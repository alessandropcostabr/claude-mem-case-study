# Regime Comparison: Pipeline (`1→LLM`) vs Self-Author

**claude-mem case study — v2 working note**
**Date:** 2026-06-11
**Source:** server-beta Postgres (`.253`), project `2e157557` (global single-project)
**Status:** working analysis (v1 README is frozen; this extends the v2 dataset).
Checkpoint Rider (C′) implemented + deployed + armed on `.100` as of 2026-06-11 (§6.1).

---

## 0. TL;DR

Two memory-generation regimes ran over **the same underlying work** (a full fleet day:
LATE feature work, a security audit, several releases, plus claude-mem itself). Compared
side by side, they are **not better/worse versions of each other — they are orthogonal
layers**:

- **Regime B — Pipeline (`1→LLM`, per-event):** a dense, real-time, high-resolution trace
  of *what happened tool-by-tool*. High recall, but redundant and unable to abstract above
  a single event.
- **Regime C — Self-author (session-level, at Stop):** a ~17× compression that keeps the
  *decisions, milestones, corrections and patterns* — and produces observation types the
  per-event pipeline **structurally cannot** — but is retrospective (not real-time).

The only axis on which the pipeline strictly dominates self-author is **timing** (real-time
vs Stop). That is exactly — and only — what **Checkpoint Rider** (C′) closes — now implemented
and live on `.100`, producing a clean same-host C vs C′ comparison (see §6 / §6.1).

---

## 1. Context: the three regimes

claude-mem can generate an observation three ways:

| Regime | Who writes it | When | LLM calls | `generation_key` |
|---|---|---|---|---|
| **A** | external Agent SDK, multi-turn | per-event | N (multi-turn) | set |
| **B** | external LLM, single-shot (`parseAgentXml`) | per-event | **1** | set |
| **C** | the session itself (`save_observation`) | at Stop | **0** | **NULL** |

Regime A→B is the maintainer's **`n→1`** optimization: it cut the *depth* of each generation
(N LLM turns → 1), moving curation into deterministic post-processing — **without leaving the
real-time loop**. Regime C is a different axis entirely: it moves *who* writes and *when*,
dropping to **0** external LLM calls but at the cost of real-time surfacing.

**Discriminator used throughout:** `generation_key IS NULL` ⇒ self-author (Regime C);
non-null ⇒ pipeline (Regime A/B). Confirmed against the live schema.

---

## 2. Method

- **Window:** `created_at >= 2026-06-10 22:00:00+00` (the first fleet burst where self-author
  fired at volume, threshold ≥ 8). Both regimes were active over the identical work.
- **Scope:** project `2e157557` (server-beta is a single global project; folder facet is a
  filter, not an isolation boundary).
- **Live snapshot:** the pipeline keeps generating in real time, so its counts drift upward
  between reads; numbers below are a point-in-time read on 2026-06-11.
- **Reproduce:** `scripts/export-regime-comparison.mjs` (queries + CSV emit). Datasets:
  `regime-comparison-metrics.csv`, `regime-type-distribution.csv`,
  `regime-pipeline-redundancy.csv`, `regime-daily-volumetry.csv`.

---

## 3. Headline metrics

`data/v2/regime-comparison-metrics.csv`

| Metric | Pipeline (`1→LLM`) | Self-author | Read |
|---|---:|---:|---|
| Observations | **1010** | **60** | ~**16.8× compression** |
| Avg length (chars) | 1302 | **1652** | self-author obs are *longer*, not shorter |
| Distinct titles | 976 | 60 | — |
| Redundant titles | **34** | **0** | pipeline re-fires the same finding per event |
| Meta/correction obs | 18 (1.8%) | **8 (13.3%)** | self-author is ~7× denser in self-correction |

The self-author layer is **fewer, longer, denser, non-redundant, higher-altitude** notes —
a session changelog, not a tool trace.

---

## 4. Type distribution — the orthogonal-layers result

`data/v2/regime-type-distribution.csv`

| `kind` | Self-author | Pipeline |
|---|---:|---:|
| discovery | 16 | 594 |
| change | 21 | 131 |
| decision | 6 | 80 |
| security_alert | **0** | 62 |
| bugfix | 9 | 58 |
| feature | 4 | 39 |
| security_note | **0** | 38 |
| refactor | 0 | 8 |
| **pattern** | **3** | **0** |
| **architecture** | **1** | **0** |

Two structural facts fall out:

1. **Self-author produces `pattern` (3) and `architecture` (1); the pipeline produces zero of
   either.** A per-event generator literally cannot emit a "pattern" — it sees one event at a
   time. Patterns and architecture are *session-arc abstractions*; only the regime holding the
   whole session in context (the session itself, at Stop) can write them.
2. **The pipeline holds 100 security observations (62 alert + 38 note); self-author holds 0.**
   The session didn't ignore security — it recorded the security *work* as outcomes
   (`change`/`bugfix`: "pwfeedback removed", "unattended-upgrades installed fleet-wide"), while
   the pipeline recorded the security *risk* as alerts — with heavy redundancy (§5).

Neither layer is a superset of the other. They capture different altitudes of the same work.

---

## 5. Per-event redundancy (pipeline)

`data/v2/regime-pipeline-redundancy.csv` (top repeats in-window)

| Occurrences | Title |
|---:|---|
| 8 | Sudo Password Stored in Plain Text Environment File |
| 6 | Credential Exposure in Command Execution |
| 3 | Zombie Connection Watchdog Implementation |
| 3 | Discord Platform Adapter Missing Bot Token Configuration |
| 3 | Zombie Connection Watchdog Implementation in WhatsApp Web Worker |

The same finding re-fires once per triggering event. This is inherent to per-event generation
and is what the real-time loop trades for freshness. Self-author has **0** such repeats —
it writes each decision once, at session end.

---

## 6. Synthesis: Checkpoint Rider

The data reframes the maintainer's "real-time vs post-process" concern. Self-author is **not a
degraded pipeline**; it is a complementary layer the pipeline cannot produce (pattern,
architecture, why-context, self-correction). Its single deficit versus the pipeline is
**timing** — it surfaces at Stop, outside the per-prompt injection loop.

**Checkpoint Rider** (design: `claude-mem-contrib/docs/checkpoint-rider-design.md`) closes
exactly that gap: it emits self-authored observations via a rider on `UserPromptSubmit` (per
substantive-N, per turn), so the session-level signal lands in Postgres during the tail of
turn N and is injectable at prompt N+1 — **real-time**. The external pipeline is retained as a
delayed coverage fallback — deferred for now, since the B+C′ dual-write is exactly the A/B we
want.

Net: the two layers in this study become **one real-time stream with two altitudes**.

### 6.1 Deployment status (2026-06-11): C′ is no longer just a design

The Checkpoint Rider was **implemented (TDD, 19 unit tests) and deployed** on `.100` —
branch `feat/checkpoint-rider` on the golden base `5938f80c` (`b16aa4c1` + PR #17 routing).
It is **armed** there (`CLAUDE_MEM_SELF_AUTHOR_REALTIME=true`), off everywhere else. A rider is
appended on `UserPromptSubmit` once substantive activity ≥ threshold and a per-prompt cooldown
clears; the session writes its observations at the turn tail via `save_observation`, tagged
`metadata.regime='C-prime'`.

**A bonus the deployment surfaced — a clean same-host A/B.** Because `.100` runs the Stop
self-author **and** the rider simultaneously, it produces *both* regimes side by side:
`metadata.regime='C'` (Stop tail) and `metadata.regime='C-prime'` (real-time rider), on the
**same host, same workload**. That eliminates the host-confound that the original cross-host
plan (C on `.254`, C′ on `.100`) carried — the C-vs-C′ timing comparison can now be made
*within* `.100`. (Untagged `generation_key IS NULL` self-author on `.254`/`.253`, which still
run the golden bundle, remains available as additional Regime-C volume.)

**Discriminator, updated for the 3-regime phase:** `generation_key` non-null ⇒ B (pipeline);
`metadata.regime='C-prime'` ⇒ C′ (rider, `.100`); `metadata.regime='C'` ⇒ C (Stop, `.100`,
tagged); `generation_key IS NULL` with no regime tag ⇒ C (Stop, `.254`/`.253`, untagged). The
metadata tag is authoritative; it does not depend on `generation_key` format (which stays NULL
because setting it would require a `/v1/memories` server change, deferred).

---

## 7. Volumetry snapshot (context)

`data/v2/regime-daily-volumetry.csv` (2026-03-09 … 2026-06-11, 89 days)

- All-time self-authored: **507** / **72,684** total observations (**0.70%**) — Regime C is
  young; it only began firing at volume on 2026-06-10.
- Self-authored per day: `0` for most of history; **06-09 = 22, 06-10 = 90, 06-11 = 31** — the
  first sustained burst after the fleet-wide threshold-8 enablement.
- Pipeline per day in the same window remains 1–4k/day — the real-time backbone is unchanged.
- **From 2026-06-11, regime=`C-prime` (real-time rider) observations begin accruing on `.100`**
  as live sessions cross the threshold; query `select metadata->>'regime', count(*) from
  observations where created_at >= '2026-06-11' group by 1`. The next data cut should report the
  same-host C vs C-prime comparison (§6.1) once enough C-prime volume has accumulated.

Implication for the v2 narrative: Regime C is positioned as a **complementary real-time layer
(via Checkpoint Rider), not a replacement** for the Regime A/B pipeline. Any claim of C
"superiority" would be unsupported; the supported claim is **orthogonality + synthesis**.

---

## 8. Provenance & caveats

- Window mixes all fleet sessions of the day (mostly LATE work). That is a feature: it is a
  multi-session, same-corpus A/B over real production work, not a toy.
- The pipeline's live generation means in-window counts are a moving target; treat ±a few % as
  noise.
- Self-author quality here is *structural* (types, redundancy, self-correction), not a human
  rating. A blind human-rated sample is the natural next step.
- Two self-authored observations on 2026-06-10 were factually wrong (claimed a design doc did
  not exist; it existed on a different fleet host) and were corrected/deprecated in PG the same
  day — itself an example of Regime C's self-correction surfacing (and needing) governance.
