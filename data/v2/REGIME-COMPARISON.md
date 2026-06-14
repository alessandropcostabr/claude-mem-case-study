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

### 6.1 Deployment (2026-06-11→12): implemented, then moved to where it fits

The Checkpoint Rider was **implemented (TDD) and deployed** — branch `feat/checkpoint-rider` on
the golden base `5938f80c` (`b16aa4c1` + PR #17 routing). A rider is appended on
`UserPromptSubmit` once substantive activity ≥ threshold and a per-prompt cooldown clears; the
session writes its observations at the turn tail via `save_observation`, tagged
`metadata.regime='C-prime'`.

**First deploy on `.100` exposed a workload mismatch.** Over ~24h, C′ fired **once** (1 obs) vs
**99** Stop-self-author (C) obs — a ~1% hit-rate that lowering the threshold (8→4) and cooldown
(2→1) did **not** move. The cause is structural, not a tuning knob: the rider fires on
`UserPromptSubmit`, but `.100` runs **autonomous** agentic workloads (long turns, few prompts).
The rider needs the *intersection* of substantive tools **and** interactive prompt cadence —
which `.100` rarely produces. The one C-prime that did fire came from a genuinely interactive
audit session.

**So on 2026-06-12 the regimes were moved to the workload each fits:**

| Host | `REALTIME` | Regime | Why |
|---|---|---|---|
| `.254` (interactive dev) | `true` | **C′** | many tools + prompts → the rider fires naturally |
| `.100`, `.253` (autonomous) | `false` | **C** (Stop) | no interactive cadence; Stop captures at session end |

This trades the (briefly hoped-for) same-host A/B for a **workload-matched** deployment: C′ where
interactive cadence exists, C where it doesn't. The C-vs-C′ comparison is therefore **confounded
by host/workload** — by design, because the two regimes suit different workloads. It is a
"deploy each where it fits" result, not a controlled A/B; claims must be framed accordingly.

**Stop made transparent under C′.** When `REALTIME=true` (i.e. `.254`), the Stop self-author no
longer blocks (no "Stop hook error") — the rider already self-authors mid-session, and the
session tail is still captured by pipeline B. Consequence: `.254` produces **only** C-prime (no
Stop-tagged C); `.100`/`.253` produce **only** C (blocking Stop, no rider).

**Discriminator (3-regime phase):** `generation_key` non-null ⇒ B; `metadata.regime='C-prime'` ⇒
C′ (rider, `.254`); `metadata.regime='C'` ⇒ C (Stop, tagged — only on hosts with the custom
bundle); `generation_key IS NULL`, no regime tag ⇒ legacy/untagged C. The metadata tag is
authoritative (the `generation_key` stays NULL; setting it would need a `/v1/memories` server
change, deferred). C-prime obs also carry `metadata.content_session_id` (parsed from the
checkpoint key) for per-session attribution, since `server_session_id` is NULL on this path.

---

## 7. Volumetry snapshot (context)

`data/v2/regime-daily-volumetry.csv` (2026-03-09 … 2026-06-12, 90 days)

- All-time self-authored: **681** / **75,558** total observations (**0.90%**) — Regime C is
  young; it only began firing at volume on 2026-06-10.
- Self-authored per day: `0` for most of history; **06-09 = 22, 06-10 = 90, 06-11 = 178, 06-12 =
  27 (partial)** — the sustained burst after the fleet-wide threshold-8 enablement.
- Pipeline per day in the same window remains 1–4k/day — the real-time backbone is unchanged.
- **C-prime so far: 1 obs (`.100`, 2026-06-11, interactive audit). With the 06-12 swap to `.254`,
  C-prime now accrues from interactive dev sessions** — query `select metadata->>'regime', count(*) from
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
