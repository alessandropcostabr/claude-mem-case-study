# Opus 4.8 degradation investigation + behavioral eval

**claude-mem case study — v2 working note**
**Date:** 2026-06-12 · **Status:** instruments live, accumulating (n still tiny)

---

## 0. The question

Community reports (and our own dogfooding) that **Opus 4.8 got worse since ~2026-06-08**, coinciding
with the **Claude Fable 5** release (2026-06-09, the new top-tier model; Opus 4.8 is its fallback).
Did 4.8 regress, and is it tied to the Fable launch? Nobody has published a number.

## 1. Public evidence (qualitative, real)

- GitHub `anthropics/claude-code#66539`: *"Severe multi-symptom degradation since 2026-06-08 on
  Opus 4.8: ignores CLAUDE.md, bypasses permission prompts, hallucinates, **refuses doable tasks**,
  writes files unprompted."*
- Community (X/Reddit, ~06/jun): *"4.7/4.8 has degraded, revert to 4.6."* Official status: incidents
  06–07/jun + elevated 4.8 errors from 09/jun.
- **No substantiated quantitative data exists publicly.** That gap is what this instruments.

## 2. Latency benchmark (throughput) — `benchmark-model-daily-20260612.csv`

The fixed-prompt latency benchmark (every 6h, 3 hosts) tests Opus 4.6 + Haiku 4.5; **Fable 5 added
06-10** (canary `.100` only), **Opus 4.8 added 06-12** (all 3 hosts).

- **Opus 4.6 and Haiku 4.5 are flat across the Fable launch (08–09/jun)** — latency ~40k ms, output
  stable. If the degradation were shared-infra, they'd dip too. They don't → **whatever hit 4.8 is
  model-specific, not a backend-wide collapse.** Consistent with (not proof of) "4.8 deprioritized
  for Fable", but unproven.
- First Opus 4.8 samples (06-12, n=7): **~32k ms, ~352 out** — *faster* than 4.6 (~39k) here. No
  latency regression visible. Fable 5: ~100k ms (≈3× slower, a heavier model), output similar.
- **Throughput ≠ behavior:** "refuses doable tasks" is a behavioral failure that latency/token
  counts cannot see. Hence the eval below.

## 3. Behavioral eval v0 — `eval-results-20260612.csv`

Fixed task suite through `claude -p`, machine-checked pass/fail, **hard token cap** (cost bounded by
construction), controls (4.6, Haiku), daily cron. Tasks map to the four #66539 symptoms:
`root-cause` (gives-up), `adherence` (ignores CLAUDE.md), `hallucination`, `restraint` (unprompted
writes). Harness: `~/.claude-telemetry/evals/`; table: `claude_telemetry.evals`.

**First round (2026-06-12, n=1 each):**

| Model | passed | CLAUDE.md | note |
|---|---|---|---|
| Haiku 4.5 | 4/4 | followed 4/4 | clean control |
| Opus 4.6 | 4/4 | **ignored 3/4** | passed core tasks |
| Opus 4.8 | 4/4 | followed 4/4 | most rigorous (ran `grep` to verify) |

**No degradation signal for 4.8.** If anything 4.8 was the most instruction-adherent here.

### 3.1 The methodological catch (more important than the score)
The hallucination verifier first flagged 4.8 as **FAIL** — but 4.8's answer was *correct* (it even
`grep`'d to confirm). The regex only matched "não existe"; 4.8 wrote "não há" + "the file exists".
**A fragile verifier nearly manufactured a "4.8 degraded" signal.** Caught by reading the real
output before concluding; verifier fixed and re-validated against the captured answers (no API
respend). Lesson for every future round: **verify the verifier; inspect `detail` before claiming a
regression.** The other 3 verifiers still need the same hardening.

## 4. Honest caveats

- **n=1 proves nothing.** Both instruments run daily; the signal (if any) needs a week+.
- **`claude -p` headless ≠ the Desktop app** where #66539 was filed — the degradation could be
  harness/Desktop-specific. A future split (API-direct vs CC-harness) would separate model from
  harness.
- Throughput benchmark and behavioral eval measure different things; neither alone is conclusive.
- Cost: eval ≈ $1.6/day/host (Opus); benchmark negligible. Token cap enforced per round.

## 5. Review point
Calendar event **2026-06-20** holds the review queries. The honest deliverable, if a signal emerges,
is **the quantitative 4.8 number the community lacks** — and if not, the data that says "perception ≠
measured", same as the v1 "CC got dumber = latency, not quality" result.
