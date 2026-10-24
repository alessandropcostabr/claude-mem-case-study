# Escala & integridade do corpus em produção (v2)

**Data:** 24/out/2026
**Fonte:** `claude_mem` @ .253 (server-beta), agregado em `data/observations-{daily,monthly,by-model}.csv` (regenerados 24/out via `data/export-observations.sh`)
**Relaciona:** utilidade causal → `THREE-WAY-REGIMES.md §MEMORY-UTILITY`; regimes → `REGIME-COMPARISON.md`; latência/versão → `VERSION-EVOLUTION.md`

> ⚠️ **Rótulo que enquadra o doc:** isto mede **escala e integridade de produção**, não **utilidade**. 354K observations é "o claude-mem rodou em escala por 6 meses", **não** "o claude-mem é útil" — essa é a pergunta causal, respondida separadamente (mem-C 96% vs control 67%, +29pp, §MEMORY-UTILITY, 09/jul). Volume ≠ valor.

---

## 1. Trajetória do corpus (6 meses em produção)

| Mês | Observations | Dias ativos |
|---|---|---|
| 2026-03 | 3.382 | 22 |
| 2026-04 | 10.800 | 29 |
| 2026-05 | 42.571 | 27 |
| 2026-06 | 50.650 | 29 |
| 2026-07 | 63.018 | 29 |
| **2026-08** | **122.318 (pico)** | 29 |
| 2026-09 | 37.104 | 30 |
| 2026-10 | 24.859 (parcial, 22d) | 22 |

**Total: ~354.641 obs** (última gerada 24/out 12:10). Crescimento ~18K (mai) → ~70K (jun) → **354K (out)**.

**Geração não-monotônica** — pico em ago (122K), **queda** set/out (~37K/~34K projetado). **Causa (confirmada):** menor uso/consumo da frota no período (menos sessões → menos observations), não defeito de pipeline. O volume do corpus acompanha a atividade real de trabalho, não um processo autônomo.

## 2. Distribuição por modelo gerador

| Modelo | obs |
|---|---|
| unknown | 338.988 |
| claude-opus-4-6 | 6.730 |
| claude-sonnet-4-5 | 6.270 |
| claude-opus-4-8 | 1.171 |
| claude-opus-4-8[1m] | 601 |
| claude-opus-5[1m] | 414 |
| claude-fable-5 | 172 |

**Caveat:** ~96% é `unknown` (pipeline não grava o modelo gerador), então o corte por modelo é pouco informativo para a maioria do corpus. **Novidade:** modelos que não existiam no início da pesquisa já aparecem (`opus-5[1m]`, `opus-4-8[1m]`).

## 3. Integridade do pipeline (server-beta escalou sem entupir)

- **Fila de embeddings (pgvector):** 0–8 pendentes a 354K obs → drenada; não há backlog.
- **Jobs de geração:** sem fantasmas/presos (GEN-QUEUE ✅).
- **Captura viva:** 32–61 sessões/dia (`server_sessions`).
- **Falha de geração (perda terminal): 0,37% em 7d** (53 falhas / ~6.000 jobs em `observation_generation_jobs`). Três classes, **nenhuma re-tentada** (`next_attempt_at` NULL apesar de `max_attempts=3`): (a) **`auth_invalid` (Anthropic 401) — crônico, ~2–3/dia há ≥14d**, em `observation_generate_session_summary` → ~2–3 resumos de sessão perdidos/dia; **único acionável** (renovação do token de auth do worker no .253); (b) `parse_error` (parser rejeita o XML do pipeline B per-event) — em burst, correlacionado a picos de atividade, transitório; (c) `unrecoverable` (400), raro. Threat to validity real mas pequeno.
- **Achado de arquitetura:** o desenho **captura incremental** (PostToolUse em streaming + `Stop`→summarize **por turno** + worker assíncrono persistindo no PG) aguentou 6 meses / 354K obs. Como não há flush único no encerramento, uma sessão morta/pausada no meio não perde o acumulado — resolve **por desenho** o problema histórico v12.4.4 ("SessionEnd não drena no /clear → obs perdidas").

## 4. Contaminação de benchmark (threat to validity) — CONGELADA

O `benchmark.sh` injetava ~30–40 obs sintéticas/dia (~1,1% do corpus v2). Com o **encerramento da coleta de telemetria em 24/out** (crons+hooks+cc-exporter desligados), essa contaminação **para de crescer** — congela no acumulado. Excluir por prompt-hash no export qualitativo segue recomendado.

## 5. Nota de reprodutibilidade — NÃO use `mem_stats`

O `mem_stats` do MCP lê o **SQLite local** do host cliente (.254), que é réplica **defasada** (~2 dias, stale *by design* — a captura real vai pro PG .253). Em 24/out ele reportou `total: 23.949` e `last_7d: 0` enquanto o PG tinha **354.641** com obs do próprio dia. **Fonte de verdade = PG `claude_mem` @ .253**, não o `mem_stats` nem o SQLite local.

---

**Status da coleta:** telemetria de benchmark encerrada 24/out; a captura de observations do claude-mem **segue ativa** (é o sistema de produção, não a pesquisa). Dados preservados no PG.
