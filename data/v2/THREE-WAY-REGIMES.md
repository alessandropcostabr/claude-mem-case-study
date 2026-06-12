# Three-way: B (pipeline 1×LLM) vs C (Stop self-author) vs C′ (Checkpoint Rider)

**claude-mem case study — v2 working note**
**Date:** 2026-06-12 · **Status:** directional (C′ n still tiny)

Extends the B-vs-C analysis (`REGIME-COMPARISON.md` §3–4) with the third regime, C′
(real-time self-author). All three are now tagged/discriminable in Postgres.

## Discriminator
| Regime | Predicate (PG) | LLM calls | When |
|---|---|---|---|
| **B** | `generation_key IS NOT NULL` (no regime tag) | 1 (single-shot REST) | per-event |
| **C** | `metadata.regime = 'C'` | 0 | at Stop (session end) |
| **C′** | `metadata.regime = 'C-prime'` | 0 | mid-session (UserPromptSubmit rider) |

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
