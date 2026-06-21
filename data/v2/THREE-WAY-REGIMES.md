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
