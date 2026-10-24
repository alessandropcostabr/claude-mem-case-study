# v2 Case Study — INDEX (mapa de entrada da pesquisa)

Pesquisa comparativa dos regimes de **geração de memória** do claude-mem: **B** (pipeline 1×LLM externo),
**C** (Stop self-author), **C′/C-prime** (rider incremental) e **C-prime-arc** (rider arco). Gerado 2026-07-09.

## Os regimes — o que significam e como registram
| Regime | Como registra | Volume (PG, 07-09) |
|---|---|---|
| **B** (pipeline) | 1×LLM **externo** lê o transcript depois da sessão | ~123.570 |
| **C** (Stop) | self-author no **fim da sessão**, revisa o arco, ancorado | ~1.282 |
| **C′ / C-prime** (rider incremental) | self-author **por turno**, "desde o último checkpoint" | ~313 |
| **C-prime-arc** (rider arco) | self-author **por turno**, revisa o arco (barra-alta desde 07-09) | ~66 |
| **(untagged)** | self-author sem regime (saves espontâneos) | ~592 |

## Onde os dados moram no PG (`.253`)
**DB `claude_mem`** → tabela `observations` (a memória em si). Discriminador canônico:
- `B` = `generation_key IS NOT NULL`
- `C` / `C-prime` / `C-prime-arc` = `generation_key IS NULL AND metadata->>'regime' = '...'`
- Campos: `content`, `kind`, `metadata` (regime/type/host/content_session_id/title), `embedding_vec`.

**DB `claude_telemetry`** → experimentos:
- `eval_rank` — painéis de juiz (R2–R5): judge_model, trio_idx, regime, obs_id, rank, why
- `evals` — eval comportamental + memory-utility: task_id, family, passed, tokens, latency
- `benchmarks` — latência/versão/modelo

## Arquivos (`data/v2/`)

### Documentos (método + resultado)
- **THREE-WAY-REGIMES.md** — MESTRE (R2–R5, rider A/B, operating model, deploy, memory-utility)
- REGIME-COMPARISON.md — comparação qualitativa B/C/C′ (proxies groundedness/hedge/código-inline)
- DATA-AUDIT-20260709.md — status de cada stream de dados (fresh/auto/local-only)
- MEMORY-UTILITY-EVAL-SPEC.md — spec do experimento de utilidade downstream (Opção C)
- MODEL-DEGRADATION-EVAL.md — eval comportamental Opus 4.8
- VERSION-EVOLUTION.md — evolução por versão CC
- SESSION-20260701-integrity-attribution.md — auditoria integridade/atribuição
- NEXT-ROUND-judge-panel.md — planejamento de painel

### Judge quality (B vs C vs C′)
- Dados: eval-rank-20260613.csv (R2), eval-rank-r2r3-20260621.csv, eval-rank-r4-20260621.csv, eval-rank-r5-20260709.csv, eval-judge-{llama33,nemotron}-20260612.csv, regime-metrics-20260621.csv
- Amostras: judge-sample-90.json (R2/R3), judge-sample-r4.json, judge-sample-r5-arc.json
- Harness: judge-rank.mjs (OpenRouter), judge-rank-nim.mjs (NVIDIA), judge-rank-r5.mjs, judge-rank-cli.mjs, judge-or.mjs, aggregate-round3.mjs, run-r5{,b,c}.sh

### Volumetria / atribuição de regime
- regime-daily-volumetry.csv, regime-type-distribution.csv, regime-comparison-metrics.csv, regime-pipeline-redundancy.csv, regime-attribution-{20260702,20260709}.csv, regime-c-volumetry-20260609.csv, observations-{daily,monthly,by-segment}.csv
- Gerador: ../scripts/export-regime-comparison.mjs

### Rider A/B (C′ incremental vs arco)
- rider-ab-by-session-20260702.csv, rider-ab-summary-20260702.csv

### Benchmarks (latência/versão)
- benchmarks-raw.csv, benchmarks-by-version.csv, benchmark-model-daily-{20260612,20260709}.csv

### Memory-utility (Opção C — utilidade downstream)
- run-mem-eval.mjs (harness) + MEMORY-UTILITY-EVAL-SPEC.md → resultados na tabela `evals` (task_id='memutil:*')

## Principais achados (resumo)
- **B < C ≈ C′** em qualidade julgada (R2–R4, 7+ juízes, p<0.05) — self-author supera o pipeline externo.
- **C-prime-arc** domina no kind-mix (~73% pattern/architecture) mas tem a MENOR qualidade por-obs (R5, p=0.0027):
  troca **altitude por ancoragem**.
- **Modelo operacional** (deployado na frota 07-09): C (Stop) base ancorada + C′-arc rider barra-alta + anchoring;
  B aposentado.
- **Caveat aberto**: tudo acima é PROXY (qualidade da nota, kind-mix). O experimento de **utilidade downstream**
  (memory-utility) ataca isso com um número causal — em andamento.

## Memórias (auto-memory) relacionadas
project_self_author · project_rider-ab-experiment · project_three-way-judge-quality · project_case-study-v2-cutover
· reference_memory-quality-baseline
