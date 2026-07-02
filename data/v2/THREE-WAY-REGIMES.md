# Three-way: B (pipeline 1×LLM) vs C (Stop self-author) vs C′ (Checkpoint Rider)

**claude-mem case study — v2 working note**
**Date:** 2026-06-12 (Round 1) · 2026-06-13 (Round 2: forced ranking, n=30, significance — see end)
**Status:** Round 2 finds self-author > pipeline for 4/5 judges (3 significant); 1 dissenter

Extends the B-vs-C analysis (`REGIME-COMPARISON.md` §3–4) with the third regime, C′
(real-time self-author). All three are now tagged/discriminable in Postgres.

## Discriminator
| Regime | Predicate (PG) | LLM calls | When |
|---|---|---|---|
| **B** | `generation_key IS NOT NULL` (no regime tag) | 1 (single-shot REST) | per-event |
| **C** | `metadata.regime = 'C'` | 0 | at Stop (session end) |
| **C′** | `metadata.regime = 'C-prime'` | 0 | mid-session (UserPromptSubmit rider) |

### Canonical self-author filter (16/jun) — exclude untagged buckets

`generation_key IS NULL` alone is NOT self-author: it also catches non-instrumented
observations. The **canonical filter** for the regime experiment is:

```sql
-- self-author (instrumented): generation_key IS NULL AND metadata->>'regime' IN ('C','C-prime')
-- pipeline: generation_key IS NOT NULL
```

The 579 `generation_key IS NULL` rows **without** a regime tag decompose into:

| bucket | n | window | note |
|---|---:|---|---|
| legacy-sqlite (`metadata ? 'sqlite_id'`) | 351 | 12–14/mai | migrated SQLite→PG, pre-experiment, hand-curated (inflates pat/arch) |
| manual saves (no `checkpoint_key`) | 181 | ≥10/jun | `save_observation` ad-hoc, outside Stop/rider (interactive sessions) |
| pre-tag self-author | 47 | 17/mai–10/jun | self-author before regime tagging existed |

These are **excluded** from regime comparisons. Effect of applying the filter to the
in-window metrics (since 10/jun 22:00): self-author **621 → 504** obs; avg_chars
**2162 → 2208** (dropped manual saves were shorter). `export-regime-comparison.mjs`
now enforces this filter; all `data/v2/regime-*.csv` are regenerated under it.

## Structure (all-time)
| | n | avg chars | redundancy | meta-correction |
|---|---:|---:|---:|---:|
| **B** (1× LLM, per-event) | **77,237** | 1101 | **8.2%** | 1.8% |
| **C** (Stop, 0×) | 150 | 1889 | 0% | 4.7% |
| **C′** (rider, 0×) | 35 | **2109** | 0% | **8.6%** |

Compression: B is ~**500×** the volume of C and ~**2200×** of C′ (B is per-event; C/C′ are
session-level). B is the shortest and the only redundant one.

## Kind mix (% within regime)
| kind | B% | C% | C′% |
|---|---:|---:|---:|
| discovery | 58 | 35 | 57 |
| change | 10 | 21 | 29 |
| decision | 5 | 14 | 6 |
| bugfix | 8 | 13 | 3 |
| **pattern** | 1 | **10.7** | **0** |
| **architecture** | 0 | **1.3** | **0** |
| **security_alert + note** | **1.7** | 0 | 0 |
| refactor | 6 | 0 | 0 |

## What the three regimes reveal — the temporal-vantage axis
The variable that separates the three is **not the generator's intelligence — it is the point in
time from which it observes**:

- **B — per-event (real-time trace):** 77k short observations, granular, and the **only** regime
  that emits `security_alert` (the risk re-firing per event) and `refactor`. The 8% redundancy is
  the cost of per-event granularity.
- **C — end-of-session (synthesis + abstraction):** the **only** regime with meaningful `pattern`
  (10.7%) and `architecture` (1.3%). Arc-level abstraction needs the Stop vantage (the whole
  session in view); neither per-event B nor mid-session C′ produces it.
- **C′ — mid-session (hybrid):** has C's session-level density (long, 0 redundancy, highest
  self-correction) **but** B's granular focus (discovery 57% ≈ B 58%), because it fires mid-session
  and sees only a partial arc. Hence still **0 pattern/architecture**.

So C′ sits structurally **between** B and C: session-level synthesis with per-event focus.

## Caveats (block any firm conclusion)
- **C′ n = 35** — ~1 day of `.254` data; the "0 pattern/architecture" could be chance (at n=35 you'd
  expect ~4 if C′ shared C's rate).
- **Workload-confound** — C′ comes from interactive `.254`, C from autonomous `.100`. The
  pattern/architecture gap could be the *workload*, not the timing. The clean same-host comparison
  was deliberately given up (`.254` is C′-only).
- **B is per-event** — its volume is not comparable 1:1 to the session-level regimes.

Directional, not conclusive. Watch the C′ pattern/architecture gap as `.254` accumulates
(review 2026-06-20). A blind quality rating (LLM-judge / human) is the next instrument — structure
is a proxy, not quality.

> **REVIEW DONE — 2026-06-21 (see "Structure update" at end):** with C′ now at n=241 (was 35)
> the pattern/architecture gap holds and is **no longer attributable to small-n** (Poisson
> p≈0.001). Two corrections also land: C's pattern rate was inflated by small-n (10.7%→3.1%),
> and C is **multi-host** (not `.100`-only), which weakens the workload-confound.

---

## Quality (content, not structure) — 2026-06-12

Structure (length, kind) is a proxy. A closer look at *content quality*, via groundedness and
calibration proxies + real samples.

### Quality proxies (% of observations)
| | has file:line ref | has inline code | hedges/uncertainty |
|---|---:|---:|---:|
| **B** (1× LLM) | **1.5%** | 28.7% | **0.2%** |
| **C** (Stop) | **27.8%** | 23.8% | 8.6% |
| **C′** (rider) | 19.4% | 5.6% | 8.3% |

### Same finding, two regimes (the tell)
The same observation ("openers-WA d8-11 list") appears in both B and C′:
- **B:** *"Lista openers-WA d8-11 não estava filtrada por click (31 clicadores dentro). Gerada
  versão SEMCLICK (474)…"* — flat, correct fact.
- **C′:** *"A lista `~/tmp/auxvet-openers-wa-d8-11-CLEAN.csv` (504 contatos, montada de manhã 12/06…)
  foi **assumida** … como 'openers sem click', mas a **verificação autoritativa**…"* — exact path,
  count, date, **and the assumption-vs-verification correction** (the *why* + a corrected premise).

### Verdict — quality is multi-dimensional (reinforces orthogonal layers)
| Quality dimension | Winner |
|---|---|
| **Groundedness** (file:line, paths, counts) | **C > C′ ≫ B** — self-author cites the real artifacts it touched; B (event-watching) is vague on file:line (1.5%) |
| **Honesty/calibration** (hedging + self-correction) | **C ≈ C′ ≫ B** — self-author knows what it doesn't know and corrects premises; B states flatly (0.2% hedge) |
| **Coverage/recall** (captures every event) | **B ≫ C/C′** — by volume (77k vs 150/35) |
| **Arc abstraction** (pattern/architecture) | **C** (only one; see structure) |

**B is high-recall but shallower and more confident** (asserts without citing a source or hedging);
**C/C′ are more grounded and better calibrated** (cite exact file:line, correct premises, admit
uncertainty). It is not "one is better" — B optimizes *coverage*, C/C′ optimize *grounded
synthesis*. In the real sample, C′ caught a premise correction that B missed.

**Rigor caveat:** these are proxies + one sample, not a rated quality score. The rigorous
instrument is a **blind LLM-judge** scoring N observations per regime on these dimensions —
a sibling of the behavioral eval. Until then: directional.

---

## Blind LLM-judge — 2026-06-12

Upgrades the quality proxies to a **rated score**. Harness: `~/.claude-telemetry/evals/judge.mjs`
(reads a pre-sampled set, judges each note 1-5 on four dimensions **without seeing its regime**,
token-capped, writes to `claude_telemetry.eval_judge`). Sample: 30 *organic* observations (10 per
regime, meta-research notes excluded); 23 scored before the token cap stopped the round ($0.76).

**Judge = Haiku 4.5, which also generates regime B → mild self-preference toward B. So any C/C′
advantage here is conservative (it survived a pro-B judge).**

### Result (blind, avg 1-5)
| regime | n | groundedness | specificity | **calibration** | **usefulness** | **OVERALL** |
|---|---:|---:|---:|---:|---:|---:|
| **C′** (rider, 0×) | 9 | 4.67 | 4.89 | 4.33 | **5.00** | **4.72** |
| **C** (Stop, 0×) | 7 | 4.43 | 4.71 | 4.57 | 4.71 | **4.61** |
| **B** (1× LLM) | 7 | 4.14 | 4.29 | **3.57** | **3.71** | **3.93** |

### Reading
- **Self-author (C ≈ C′, ~4.6–4.7) outscores the pipeline (B, 3.93)** — and the gap is widest exactly
  where the proxies predicted: **calibration** (B 3.57 vs 4.3–4.6) and **usefulness** (B 3.71 vs
  4.7–5.0). B is grounded/specific enough but reads as flatter, more confident, and less directly
  useful as a future-session note.
- **The result is robust:** the judge is the model that *produces* B, so bias runs *toward* B — yet
  B scored lowest. The C/C′ advantage cleared that headwind.
- **C vs C′ is a tie within noise** (4.61 vs 4.72, n=7/9) — consistent with "same engine, different
  timing": timing changes *what* they capture (structure, §kind-mix) more than *how well*.

### Caveats
- **n = 7–9 per regime** (token cap cut the round at 23/30) — directional, not significant yet.
- **Single judge.** A neutral judge or a multi-model panel would remove the self-preference
  caveat and the single-rater variance. Done below.
- The judge scores *signals from the text*, not factual accuracy (it lacks the codebase).

## Neutral judge — NVIDIA Nemotron-3-Ultra-550B — 2026-06-12

Adds the **second, neutral rater** the caveat above called for. Harness:
`~/.claude-telemetry/evals/judge-or.mjs` (same rubric, same 30-obs sample, same blinding) routed
through OpenRouter to **`nvidia/nemotron-3-ultra-550b-a55b:free`** — a model that produces **none**
of the three regimes, so there is **no self-preference in any direction**. All 30 scored (free tier,
$0 cost).

> Op note: Nemotron-3-Ultra is a *reasoning* model. The first run scored 30/30 FAIL — `max_tokens=200`
> was consumed entirely by hidden reasoning (`finish_reason:length`, empty content). Fix: `/no_think`
> prefix **+ `max_tokens=2500`** → `finish_reason:stop` and clean JSON. (The dead `.253` claude-mem
> OpenRouter key returned 401 "User not found"; the live key lives at `.100:~/.env/openrouter.env`.)

### Result (neutral, blind, avg 1-5, n=10 each)
| regime | n | groundedness | specificity | calibration | usefulness | **OVERALL** |
|---|---:|---:|---:|---:|---:|---:|
| **C** (Stop, 0×) | 10 | 5.00 | 5.00 | 5.00 | 5.00 | **5.00** |
| **C′** (rider, 0×) | 10 | 5.00 | 5.00 | 4.90 | 5.00 | **4.97** |
| **B** (1× LLM) | 10 | 4.60 | 4.60 | 4.20 | 4.60 | **4.50** |

### Reading — agreement *with a caveat about the instrument*
- **Same ordering as Haiku: C ≈ C′ > B.** Two judges with opposite bias profiles (Haiku *makes* B;
  Nemotron makes nothing) put B last and C/C′ tied at the top. The C/C′ > B finding is **robust to
  judge identity** — it is not a Haiku self-bias artifact.
- **But Nemotron is a ceiling-saturated rater, not a discriminating one.** Score distribution over all
  30 notes: **26× perfect `5/5/5/5`**, 1× `1/1/1/1` (a single B note it rejected outright), 2× `c=3`,
  1× `c=4`. Almost all of B's deficit comes from that one harsh outlier plus a few sub-5 calibrations —
  *all landing on B*. So Nemotron **agrees on direction but carries almost no variance**; it can
  confirm the ranking, not measure the gap.
- **Net:** the *discriminating* instrument is still Haiku (real spread, and biased toward the regime it
  rated lowest). Nemotron's role is narrow and now fulfilled: **a neutral second opinion that does not
  overturn the order** — removing the "maybe it's just Haiku liking its non-B siblings" objection.

### Caveats
- **Saturation = low information.** A 5.0 ceiling means Nemotron can't quantify the C/C′↔B gap; treat
  it as a sign test (B lowest), not a magnitude estimate.
- A genuinely *discriminating* neutral judge (a stricter rubric, forced ranking, or a stronger neutral
  model) remains the cleanest next step. Done below.

## Third judge — Llama-3.3-70B (neutral AND discriminating) — 2026-06-12

The Nemotron caveat asked for a neutral judge that *discriminates*. `meta-llama/llama-3.3-70b-instruct`
(via OpenRouter, **paid** — the `:free` tier 429-throttled at 25/30, so we used the $0.10/$0.32-per-Mtok
paid route, ~$0.01 total) is neutral (Meta generates none of the regimes), non-reasoning (no `/no_think`
gotcha), **0 FAIL on 30/30**, and — unlike Nemotron — it actually spreads its scores.

### Result (neutral, blind, avg 1-5, n=10 each)
| regime | n | groundedness | specificity | calibration | usefulness | **OVERALL** |
|---|---:|---:|---:|---:|---:|---:|
| **C** (Stop, 0×) | 10 | 4.80 | 5.00 | 4.30 | 5.00 | **4.78** |
| **C′** (rider, 0×) | 10 | 4.60 | 5.00 | 4.50 | 5.00 | **4.78** |
| **B** (1× LLM) | 10 | 4.20 | 4.80 | 4.10 | 5.00 | **4.53** |

- **Discriminates where it matters: groundedness spans 2→5, and both `g=2` notes are B.** B is last
  again. (Llama still saturates *usefulness* at 5.0 for everyone — so the live axes are
  groundedness/calibration, and B trails on both.)

## Panel verdict — three judges, three bias profiles, one ordering

| judge | profile | C | C′ | **B** |
|---|---|---:|---:|---:|
| Haiku 4.5 | *generates B* (pro-B bias), discriminating | 4.61 | 4.72 | **3.93** |
| Nemotron-3-Ultra | neutral, ceiling-**saturated** | 5.00 | 4.97 | **4.50** |
| Llama-3.3-70B | neutral, **discriminating** | 4.78 | 4.78 | **4.53** |

**All three put B last; C ≈ C′ tied at the top.** The conclusion holds across a judge that is *biased
toward B*, a *saturated* neutral, and a *discriminating* neutral — and in both discriminating judges
the harshest **groundedness** scores land on B. **`C/C′ > B` is robust to judge identity; C vs C′ is a
tie.** The remaining honest caveat is **n=10/regime** (directional, not yet significant) and that
*usefulness* saturates for two of three judges (the signal lives in groundedness + calibration).

---

## ROUND 2 — forced ranking + n=30 + significance — 2026-06-13

The Round-1 caveats (n=10, usefulness ceiling, single absolute scale) are addressed here, and the
result is **more nuanced — and partly corrects Round 1**.

**Two methodological upgrades:**
1. **Balanced, fairer sample (n=30/regime, 90 obs):** organic notes only (meta-research excluded), and
   crucially **B drawn from the SAME time window as C/C′ (Jun 11–13)** so we don't confound *quality*
   with *era*. (Round 1's B may have been older/shorter.) File: `judge-sample-90.json`.
2. **Forced ranking instead of absolute 1–5:** each judge sees a shuffled trio (1 B + 1 C + 1 C′, in a
   deterministically-permuted position) and must produce a **strict** best→mid→worst order. This kills
   the saturation ceiling that pinned *usefulness* at 5 for everyone in Round 1. Harness:
   `judge-rank.mjs` (OpenRouter) + `judge-rank-cli.mjs` (local Haiku). Table: `eval_rank`. Raw:
   `eval-rank-20260613.csv`.

### Result — 5 judges, mean rank (1=best, 3=worst; chance = 2.00)
| judge | profile | C | C′ | **B** | trios | B-last | sign-test p |
|---|---|---:|---:|---:|---:|---:|---:|
| **Haiku 4.5** | *generates B* | 1.59 | **1.52** | **2.89** | 27 | **93%** | **1.9e-10** |
| **DeepSeek-V3.1** | neutral | 1.83 | **1.60** | 2.57 | 30 | 73% | **8.8e-6** |
| **gpt-oss-120b** | neutral | 1.77 | 1.77 | 2.47 | 30 | 60% | **2.5e-3** |
| **qwen-2.5-72b** | neutral | 2.03 | 1.77 | 2.20 | 30 | 47% | 0.09 (~) |
| **Llama-3.3-70b** | neutral | 1.93 | 2.03 | 2.03 | 30 | 40% | 0.28 (n.s.) |

(sign test: P(B ranked last) vs H0 = 1/3.)

### Reading
- **B is ranked worst by 4 of 5 judges; 3 significantly** (Haiku, DeepSeek, gpt-oss). **Llama is the
  lone dissenter** (a genuine tie, 40% ≈ chance), qwen is marginal.
- **The pro-B caveat flips.** Round 1 warned Haiku might favour B (it *generates* B). The opposite is
  true: **Haiku is the HARSHEST on B** (B last 25/27, p≈1e-10). So the "self-preference toward B"
  worry was unfounded — if anything the B-generator is B's toughest critic. That strengthens, not
  weakens, the anti-B signal.
- **C vs C′ stays a wash** with a mild C′ tilt (C′ ≤ C for Haiku/DeepSeek/qwen, tie for gpt-oss, C
  better only for Llama). Consistent across both rounds: *same 0×LLM engine, timing changes WHAT they
  capture (§kind-mix), not HOW WELL.*

### What Round 2 corrects in Round 1
Round 1 claimed "C/C′ > B is **robust to judge identity**." **That was too strong.** Under forced
ranking on a fair sample, the advantage is **real for the majority but NOT universal** — Llama sees a
tie. Part of Round 1's clean separation came from (a) the absolute-scale ceiling exaggerating B's
calibration/usefulness deficit, and (b) possible B-sample-era effects. The honest claim now:
**self-author (C/C′) out-ranks the pipeline (B) for 4 of 5 judges, significantly for 3 — a strong
majority signal, with one credible dissenter.**

### Caveats (Round 2)
- **Judges disagree** — that disagreement is now the headline, not a footnote. A larger judge panel
  (or human raters) would settle Llama-vs-the-rest.
- **Pooling across judges violates independence** (same 30 trios judged 5×) — report per-judge, not a
  pooled p. Per-judge, 3/5 are significant.
- Trios pair B[i]/C[i]/C′[i] by sample order (deterministic from `md5(id)` DB ordering), not by topic —
  notes within a trio are unrelated; the judge ranks *quality signals*, not the same finding told 3×.

---

## STRUCTURE UPDATE — 2026-06-21 (robust n; C′ review closed; corrections)

The 2026-06-20 review (above) is executed here. Volumes grew enough to kill the small-n caveat
that blocked the C′ structural conclusion.

### New volumes (all-time, vs 16/jun snapshot)
| | n (16/jun) | **n (21/jun)** | avg chars |
|---|---:|---:|---:|
| **B** (1× LLM, per-event) | 77,237 | **96,257** | 1,148 |
| **C** (Stop, 0×) | 150 | **617** | 2,371 |
| **C′** (rider, 0×) | 35 | **241** | 2,068 |

### Pattern/architecture — the C′ caveat resolves
| | pattern+arch | rate |
|---|---|---:|
| **C** (Stop) | 23/617 | **3.7%** |
| **C′** (rider) | 1/241 | **0.4%** |

At n=241, if C′ shared C's rate we'd expect ~9 arc-level notes; we see **1**. One-sided Poisson
(λ≈9) gives **p≈0.001** — the gap is **real, not small-n chance**. This confirms the
temporal-vantage axis: only the Stop vantage (whole session in view) abstracts arc; the mid-session
rider sees a partial arc and essentially never emits `pattern`/`architecture`.

### Two corrections to the earlier sections
1. **C's pattern rate was inflated by small-n.** §kind-mix reported pattern 10.7% / architecture
   1.3% at n=150. At n=617 these are **pattern 3.1% / architecture 0.6%** (combined 3.7%). The
   *direction* (C ≫ C′) holds and is now robust, but C abstracts **less** than the original note
   implied. Treat the §kind-mix table as the n=150 snapshot.
2. **C is multi-host, not `.100`-only.** Recent C observations come from **mach10 (.253), HyperII
   (.100) AND DarkStarII (.254)**. The Caveats §"workload-confound (C from autonomous .100, C′ from
   interactive .254)" is therefore **weaker than stated** — C is fleet-wide. (Op note: C generation
   stalled 20–21/jun = weekend activity −91% + `.253` OAuth token expired; not a self-author bug.)

### ROUND 3 — NVIDIA NIM judge panel (DONE 2026-06-21, same frozen 90-obs sample)
Adds 7 neutral judges from **distinct model families** (via `integrate.api.nvidia.com`, free tier) to
the Round-2 panel — same trios, just more independent votes — to settle the Llama-3.3 dissent.
Harness: `judge-rank-nim.mjs`; aggregate: `aggregate-round3.mjs` (per-judge exact binomial sign test).

### FULL PANEL — 12 judges, mean rank (1=best, 3=worst; chance=2.00)
| judge | round | C | C′ | **B** | B-last | sign-p |
|---|---|---:|---:|---:|---:|---:|
| claude-haiku-4-5 | R2 | 1.59 | 1.52 | 2.89 | 25/27 93% | **1.9e-10** |
| deepseek-chat-v3.1 | R2 | 1.83 | 1.60 | 2.57 | 22/30 73% | **8.8e-6** |
| **meta-llama-3.3-70b** | R2 | 1.93 | 2.03 | 2.03 | 12/30 40% | 0.276 *(dissenter)* |
| gpt-oss-120b | R2 | 1.77 | 1.77 | 2.47 | 18/30 60% | **0.002** |
| qwen-2.5-72b | R2 | 2.03 | 1.77 | 2.20 | 14/30 47% | 0.090 ~ |
| deepseek-v4-pro | R3 | 1.80 | 1.60 | 2.60 | 7/10 70% | 0.020 * |
| gemma-4-31b | R3 | 1.70 | 1.57 | 2.73 | 23/30 77% | **1.5e-6** |
| llama-4-maverick | R3 | 1.67 | 1.70 | 2.63 | 21/30 70% | **4.4e-5** |
| mistral-large-3-675b | R3 | 1.73 | 1.80 | 2.47 | 9/15 60% | 0.031 * |
| nemotron-3-super-120b | R3 | 1.67 | 1.67 | 2.67 | 23/30 77% | **1.5e-6** |
| gpt-oss-120b (nvidia) | R3 | 1.63 | 1.93 | 2.43 | 18/30 60% | **0.002** |
| qwen3.5-397b | R3 | 1.70 | 1.43 | 2.87 | 27/30 90% | **1.7e-10** |

(deepseek-v4 n=10, mistral-large-3 n=15 — aborted on free-tier rate-limit; same direction, weaker power.)

**Verdict: 12/12 judges rank B worst-than-chance; 10/12 significant (p<0.05).** Both Round-2 caveats close:
1. **The Llama-3.3 dissent is now isolated.** It is the lone non-significant outlier against 11 other
   judges — and **Llama-4-maverick, same Meta family, is strongly anti-B (70%, p=4.4e-5)**. The dissent
   was **generation-specific to Llama-3.3, not a Meta-family trait.**
2. **The Qwen family flipped with the new generation.** qwen-2.5 was marginal (47%, n.s.); **qwen3.5-397b
   is the single strongest anti-B judge (90%, p=1.7e-10).**

The signal now spans **8 distinct families** (Anthropic, DeepSeek, Meta, Qwen, OpenAI, Google, Mistral,
NVIDIA). **C vs C′ stays a tie** across both rounds — timing changes WHAT they capture (§kind-mix), not
HOW WELL. Honest residual caveats: still the same 90-obs sample (a larger re-sample = Round 4); per-judge
reporting only (pooling violates independence — same 30 trios judged 12×); two R3 judges have small n.

---

## ROUND 4 — larger fresh re-sample (n=80/regime) — 2026-06-21

The last R3 caveat ("still the same 90-obs sample") is addressed here. New sample: **240 obs
(80/regime)**, drawn from the **full fresh window (10–21 Jun)** under the canonical filter, with **B
from the same window** (era control preserved). File: `judge-sample-r4.json`. Seven NVIDIA judges
(distinct families), **including Llama-3.3 on purpose** — the R2/R3 dissenter — to test whether its
tie survives a bigger sample. Stored isolated (`r4:` prefix). Raw: `eval-rank-r4-20260621.csv`.

### Result — 7 judges, B-last rate (n=80 except where noted)
| judge | trios | B-last | sign-p |
|---|---:|---:|---:|
| qwen3.5-397b | 80 | 84% | **1.9e-20** |
| gemma-4-31b | 80 | 79% | **1.0e-16** |
| nemotron-3-super-120b | 80 | 74% | **1.7e-13** |
| llama-4-maverick | 80 | 70% | **2.3e-11** |
| gpt-oss-120b | 80 | 64% | **2.6e-8** |
| **meta-llama-3.3-70b** | 80 | **53%** | **~1.4e-4** ✅ |
| deepseek-v4-pro | 10* | 80% | 0.003 |

(*aborted on free-tier rate-limit.)

### Verdict — the dissent was small-n, and it's now gone
**7/7 judges rank B worst, ALL significant (p<0.05).** The headline: **Llama-3.3 — the lone dissenter
in R2/R3 (40%, p=0.276 at n=30) — converted at n=80 to 53% B-last, p≈1.4e-4 (significant)**. Its tie
was a **small-sample artifact**, not a real divergence; on a fresh, larger sample even the holdout
agrees B is worst. The remaining caveats also weaken: the sample is now larger (n=80) and from the
full window, not 3 days. **C vs C′ stays a tie** (mild C tilt this round vs mild C′ tilt before = noise).

**Bottom line across R2+R3+R4 (19 judge-runs, 8 families):** self-author (C/C′) out-ranks the pipeline
(B) **robustly and now without a credible dissenter**. C and C′ remain indistinguishable in quality —
they differ in *what* they capture (structure/kind-mix), not *how well*.

---

## RIDER A/B (C-prime incremental vs C-prime-arc) — preliminary result + anti-demand-effect — 2026-06-29

This closes the one axis where C′ lost to C in the three-way: **arc abstraction** (pattern/architecture).
The §STRUCTURE-UPDATE showed C′ emits ~0 pattern/architecture (0.4–0.6%) vs C's 3–4%, and attributed it
to **temporal vantage** (mid-session can't see the whole arc). The Rider A/B (deployed `.254` 2026-06-23,
`riderArm(sid)` djb2-xor 50/50, between-subjects) tests the rival hypothesis: the gap is **prompt scope**,
not timing. Arm A (`C-prime`) = historical incremental prompt ("since the last checkpoint, max 3"). Arm B
(`C-prime-arc`) = same real-time rider, prompt reframed to "review the arc-so-far, abstract
pattern/architecture when already visible." Same mechanism (mid-session, online, injectable at prompt N+1),
only the instruction changes.

### Result (PG `.253`, as of 2026-06-29; host = DarkStarII/.254)
| arm | regime | n | sessions | pattern+arch | rate |
|---|---|---:|---:|---:|---:|
| incremental (control) | `C-prime` | 313 | 49 | 2 | **0.6%** |
| **arc (treatment)** | `C-prime-arc` | **7** | **3** | **6** | **85.7%** |
| Stop baseline | `C` | 864 | — | 27 | 3.1% |

Same-window check (≥24/jun, the fair 50/50 comparison): incremental **1/14 sessions** had pat/arch (1.9%)
vs arc **3/3 sessions** (every arc session produced pattern/architecture). The arc arm even **exceeds the
Stop baseline** (85.7% vs 3.1%).

### Conclusion — the C′ abstraction gap was PROMPT-driven, not timing-driven
Reframing the rider's window recovers arc-level abstraction **in real time**. If the limit were structural
(mid-session can't see the arc), no prompt could recover it — but it did. **Real-time arc abstraction is
achievable**; the earlier "only the Stop vantage abstracts arc" was an artifact of the rider's incremental
prompt, not a law of the real-time regime.

### Anti-demand-effect verification (the arc prompt explicitly says "abstract pattern/architecture" — is it
just relabeling to please the instruction?). Read full content of all arc obs vs incremental obs on the
**same work** (2FA PR #1734; Meta Ads canvas). Verdict: **genuine abstraction, not relabeling.** Three
independent signals:
1. **Content genuinely generalizes** — e.g. `[architecture]` TOTP encryption framed as "expand-contract
   4-PR rollout, **reusable for any at-rest crypto / load-bearing column format change**"; `[pattern]`
   distilling 3 Codex findings into **categorized reusable gotchas** (cross-layer / fail-open / boundary).
   Transferable principles, not session facts.
2. **The arm is discriminating, not blind** — 1 of the arc obs was correctly tagged `change` ("completed
   angles 01-05"), not pattern. A demand effect would tag everything as abstraction; it didn't.
3. **Same work, two altitudes** — incremental logs the event (`[change]` "release v2.36.0, backfill 2
   secrets"); arc extracts the principle (`[architecture]` "expand-contract gated on PROD"). Altitude
   difference is visible in the text, not a tag swap.

### Caveats (still preliminary)
- **n = 3 sessions** (PR #1734 25/jun, canvas 26/jun, +1 on 29/jun). Honest unit is sessions: 3/3 vs 1/14
  (Fisher ~p≈0.01). The content verification proves *quality*, not *n*. Needs ~10-15 arc sessions for firm
  significance.
- The intrinsic instruction effect (prompt asks for abstraction) **is the tested mechanism**, not a confound.

### Fleet design (confirmed from data, not an anomaly)
The A/B test runs **`.254` ONLY**; the rest of the fleet is **B (pipeline 1×LLM) + C (Stop, session-end)**.
B runs everywhere (~96k obs). Verified host×regime (≥11/jun): `.254` = `C-prime` 313 + `C-prime-arc` 7 + `C` 94;
`.100` (HyperII) = `C` 660 + `C-prime` 1 (legacy, pre-12/jun swap), rider **disabled** (`REALTIME=false`,
no `riderArm` in bundle); `.253` (mach10) = `C` 109. This is the deliberate 12/jun swap, not staleness.

### DECISION (2026-06-29) — `.254` → 100% arc, to accelerate the rare cell
The bottleneck is arc-arm sessions (3), not C′ in general (incremental baseline is saturated at 313/49
sessions). Cheapest lever: flip the `.254` A/B from 50/50 to **100% arc** (force arm B in `riderArm`) — doubles
arc accrual, **no new host, preserves the `.254`-only design, keeps C and B intact**. Arc keeps recording
**online** (rider, injectable N+1); C (Stop) keeps running transparently in parallel.
**EXECUTED 2026-06-29 01:16 BRT:** surgical patch of the live `worker-service.cjs` `riderArm` (`_Y`) → always
returns `'arc'` (prompt builder `yNe` and tagger `bY` both share `_Y`, so prompt↔tag stay consistent). Golden
markers preserved (inject=2, BanditEngine=1, C-prime-arc=1, scoreAndRank=2; −23 bytes). Worker restarted,
active, NRestarts=0, /api/health=200, journal clean. Backup `worker-service.cjs.bak-pre-100arc-20260629-011539`.
Source edit also kept in `/tmp/cr-impl/src/shared/self-author.ts` (uncommitted) so a future esbuild rebuild
reproduces it. Revert = restore backup (or `return h%2===0?'incremental':'arc'`). From now every `.254` rider
fire → `C-prime-arc`.

**`.100` → C′ deferred (secondary).** With autonomous Fable/OpenClaw retired and interactive woo dev now on
`.100`, the old "autonomous → rider won't fire" veto no longer holds — `.100` is *plausibly* viable now. But
switching it costs: breaks the `.254`-only design, needs the arc bundle deployed there + sync-clobber care,
and adds a domain confound (woo/PHP/ops vs LATE/Node). Its only unique payoff is **cross-domain generalization
evidence** — worth doing only after the signal is firm on `.254`.

### DATA-INTEGRITY AUDIT + ROOT FIX (2026-07-01) — the `n` is a LOWER BOUND; a write-loss leak was found and closed
Auditing whether the accrued arc obs are *complete*, reconciled three sources (PG obs, local
`self-author/*.state.json` checkpoint counters, MCP write logs) for the 7 arc sessions:

| | value |
|---|---:|
| Checkpoints **fired** (Σ `lastCheckpointSeq`) | **48** |
| Checkpoints that produced ≥1 obs | 25 |
| **Obs landed in PG** | **26** (7 sessions) |
| Empty checkpoints (0 obs) | 23 |
| Max obs per checkpoint (cap = 3) | **2 — cap never hit** |

Three gap categories, only one is real loss:
1. **Cap truncation → NONE.** Max 2 obs/checkpoint vs cap 3 → nothing was cut by the limit.
2. **"Nothing salient" declines → by design.** Most of the 23 empty checkpoints are legit (the pattern was
   already abstracted at an earlier checkpoint). Cannot distinguish, without reading transcripts, a legit
   decline from the busy primary agent silently skipping a real pattern — this is the self-author's structural
   weakness (compliance-dependent), exactly the axis where the per-event pipeline B is deterministic.
3. **Write rejections → mostly SELF-HEALED; content is RECOVERABLE.** The MCP logs show **12 `save_observation`
   calls rejected with HTTP 400** (10× invalid `type` — out-of-enum kind, e.g. `reference`; 2× empty narrative).
   Reconciling the two arc sessions' CC transcripts (`.jsonl` `tool_use` blocks) against PG **corrects the
   first-pass claim** ("≥2 lost, unrecoverable"):
   - The MCP log lacks the payload, **but the CC session transcript keeps every `save_observation` input** →
     the attempted content is **fully recoverable** (title/type/narrative/facts).
   - `ba52feaf` (25/06): 3 calls, **all 3 landed** — the 25/06 18:57 rejection was a *different concurrent
     session*, not this arc session (the earlier time-window attribution was wrong).
   - `8d9ff3d2` (01/07): 9 calls, 7 landed. The `type:"reference"` rejection (18:55:25) **self-healed** — the
     model re-saved the same content as `discovery` 23s later → **it is in PG**. One call — a *valid-type*
     `[bugfix]` on the EADDRINUSE:9464 root cause (14:11:30) — did **not** land, for a **non-enum reason**
     (transient 5xx/drop, not validation). Its topic is independently covered by the **B pipeline**
     (`v2.40.1 PROD: Root fix for worker OTEL port collision`), so it is not a knowledge gap; the detailed
     self-author version is recoverable from the transcript.
   - **Net permanent self-author loss across the two arc sessions ≈ 1 obs, and it is recoverable.**

**Fleet-wide sweep (1181 transcripts, 517 `save_observation` calls) — the type-enum problem NEVER lost
content.** All **12** invalid calls (bad `type` or empty narrative) **self-healed within ~15-30s** via a retry
with a valid type. The invalid types the model tried are exactly the **memory-layer taxonomy**
(`feedback`, `correction`, `project`, `reference`) — i.e. the session confused the *observation* enum with the
*memory* node types, then corrected. So the enum fix **removes a wasted rejection→retry round-trip + log
noise**, it does NOT recover lost signal (there was none from this class).

**Valid-type transient-drop loss quantified fleet-wide = 0%.** Reconciling all valid-type `save_observation`
calls (471 distinct, 60 sessions, full-title match) against PG genkey-NULL obs: **471/471 landed, 0 dropped.**
The anchor that seemed lost — the `[bugfix]` EADDRINUSE obs in `8d9ff3d2` — actually **landed** as a self-author
obs with `regime = (none)` and `content_session_id = NULL` (that is why a `sid`-scoped query missed it). So the
prior "≈1 recoverable loss" is also **retracted: net self-author content loss = 0.**

**The real defect is attribution, not loss.** Of 1813 genkey-NULL self-author obs: C (Stop) is **895/895 with
NULL `content_session_id`** (Stop never carries a checkpoint_key → never tagged), plus **579 obs with no
`regime` at all** — spontaneous mid-session saves the model makes *outside* a rider checkpoint (the EADDRINUSE
one is one of these). They land but count toward **no regime**, blinding per-session/per-regime analysis. This
is a metadata gap (fixable: tag Stop/spontaneous saves), not data loss.

**Consequence for the headline:** the arc count is **unaffected — all 26 `C-prime-arc` obs carry a sid** — so
the arc rate **65.4% (17/26, n=7 sessions)** stands, **still ~100× the incremental arm (0.6%) and ~20× the Stop
baseline (3.1%)**. Net audit result: the self-author write path loses **nothing**; its real weaknesses are
compliance-dependent declines (§2 above) and metadata tagging (this §), not durability. The type-enum fix +
this audit close the "is the data complete?" question: **yes, nothing is lost.**

**Attribution fixes (2026-07-01).** (a) **Backfill:** 164 `.254` self-author obs (100 C + 64 no-regime) that
were NULL-sid recovered their `content_session_id` by full-title match against local transcripts (unique, 0
ambiguous; flagged `content_session_id_backfilled=true`, reversible). 1309 remain — they need `.100`/`.253`/`.94`
transcripts (that is where blocking-Stop C obs are authored). (b) **Forward fix (source, commit `0c98353f`,
34/34 tests):** the Stop prompt now carries `checkpoint_key="selfauthor:<sid>:stop"` → Stop obs get
`content_session_id` and stay regime C. Deploy pending on `.100`/`.253` (blocking-Stop hosts; `.254` Stop is
transparent so it is dormant there). Spontaneous saves (no hook/no key) remain unattributed — would need the CC
session id plumbed to the MCP/worker (separate feature).

**ROOT FIX (deployed 2026-07-01 ~21:12 BRT):** neither the arc rider nor `SELF_AUTHOR_PROMPT` told the session
the exact `type` enum. Both now enumerate `discovery|decision|feature|bugfix|change|pattern|architecture`
verbatim (new `OBSERVATION_TYPE_ENUM` constant). Incremental rider left byte-identical (frozen control, dead
arm under 100%-arc). Source commit `d10f5f9f` on `feat/checkpoint-rider` (local, no push). Worker rebuilt via
`scripts/build-hooks.js` — fresh bundle reproduced all 7 golden markers (inject=2, BanditEngine=1,
scoreAndRank=2, C-prime-arc=1, ARCO=1, server-beta=1, self.author=4) + the enum; deployed to `.254`, worker
active/NRestarts=0/health ok, journal clean. Backup `worker-service.cjs.bak-pre-enumfix-20260701-211245`.
Post-fix arc obs should carry only valid `type`s → re-check the 400 count is flat after a few new arc sessions.
⚠️ Separate pre-existing item: 3 red tests in `checkpoint-rider.test.ts` assume the 50/50 split and fail under
the 100%-arc hardcode (not caused by this fix); clean up when the A/B override is made configurable.

### Side finding (c-mem health, unrelated) — MCP search returns 0 observations on `.254`
The `search`/`observation` MCP tool returns **only prompts, 0 observations** — even for old terms ("deploy",
"checkpoint rider"). Not a stale-index lag (old obs missing too); the observation-search path on this host is
broken/misrouted (likely reading a local SQLite empty of obs instead of PG `.253`, or `content_search` not
populated). Direct PG ILIKE finds everything. Affects manual recall and possibly injection quality. **Pending
diagnosis.**
