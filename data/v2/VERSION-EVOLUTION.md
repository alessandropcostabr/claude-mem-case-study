# Evolução do Claude Code por versão — latência e output (v2)

**Data:** 16/jun/2026
**Fonte:** `claude_telemetry.benchmarks` @ .253 (2102 runs, 15/abr → 16/jun) — agregado em `data/benchmarks-raw.csv` / `data/benchmarks-by-version.csv`
**Relaciona/estende:** `~/.claude/claude-mem-comparativo/PESQUISA-2026-06-10-latencia-host-confound.md`

> ⚠️ **Caveat que enquadra todo este doc:** a latência ponta-a-ponta do CC é **dominada por carga de host**, não por versão. Sem controlar o host, versão e host ficam **confundidos** (cada versão experimental rodou num único host). Os números abaixo só fazem sentido **com o host controlado**. Não use isto como prova de "regressão/ganho por versão" sem essa ressalva.

---

## TL;DR

1. **Em hosts limpos (DarkStarII/.254, mach10/.253), a latência MELHOROU** ~40% de 2.1.89 (~20s) a 2.1.178 (~12,8s) — **sem regressão**, estável desde 2.1.144.
2. **A "regressão por versão" é artefato de host:** as versões intermediárias (2.1.112–2.1.170) foram medidas quase só na HyperII/.100, uma máquina **3,6×–9,5× mais lenta na MESMA versão** por carga (50+ crons, OpenClaw, load alto).
3. **Output tokens estável (~379–422)** em todas as versões → o modelo **não piorou em qualidade**; o que varia é wall-clock, e wall-clock é host.
4. **Dados novos (2.1.172/177/178) confirmam:** medidos em host limpo, ficam em ~12k ms — coerentes com a série limpa, nenhuma degradação.

## 1. Latência em hosts limpos (Haiku, `infra-check`) — sem regressão

| Versão | Latência média (DarkStarII+mach10) | n |
|---|---|---|
| 2.1.89  | ~20.300 ms | 259 |
| 2.1.144 | ~13.200 ms | 97 |
| 2.1.161 | ~11.400 ms | 58 |
| 2.1.163 | ~11.700 ms (mach10) | 24 |
| 2.1.172 | ~11.800 ms (mach10) | 15 |
| 2.1.177 | ~12.000 ms (mach10) | 5 |
| 2.1.178 | ~12.800 ms (mach10) | 2 |

→ **melhora de ~40%** de 2.1.89 → 2.1.161, e **estabilidade** dali até 2.1.178. (n pequeno em 177/178 — só mach10 mediu as mais recentes.)

## 2. O confounder de host (mesma versão, hosts diferentes)

| Versão | hosts limpos | HyperII (.100) | penalidade |
|---|---|---|---|
| 2.1.144 | ~13.200 ms | 47.406 ms | **3,6×** |
| 2.1.161 | ~11.400 ms | 108.989 ms (n=2) | **~9,5×** |
| 2.1.163 | ~11.700 ms | 100.235 ms | **~8,5×** |
| 2.1.170 | (sem baseline limpo) | 104.337 ms | ~8–9× vs contemporâneos |

A penalidade da HyperII **cresceu no tempo** (3,6× em abr → ~9× em jun), consistente com a máquina acumulando carga — **efeito de host, isolado da versão**.

## 3. Output tokens estável (não-degradação de qualidade)

| Versão | output médio (hosts limpos) |
|---|---|
| 2.1.89 | 393 |
| 2.1.144 | 382 |
| 2.1.161 | 422 |
| 2.1.163 | 383 |
| 2.1.172 | 394 |
| 2.1.177 | 398 |
| 2.1.178 | 379 |

Sem tendência — o volume de saída para o mesmo prompt é constante ao longo de ~90 versões.

## 4. O que NÃO se pode concluir

- **Não** há evidência de regressão de latência *por versão* nos hosts limpos — o oposto (melhora).
- **Não** dá pra isolar efeito de versão na HyperII: ela não tem baseline 2.1.89 próprio, então comparar "vs 2.1.89" reintroduz o confounder.
- O efeito de versão, se existe, é de **segunda ordem** e não isolável com o desenho atual (cada versão experimental num único host).

## 5. Threats to validity

- **Confounding host×versão** (o central — §2).
- **n pequeno** em células recentes (2.1.161 HyperII n=2; 2.1.178 mach10 n=2).
- `latency_ms` = wall-clock do `claude --print` inteiro (boot CC + hooks claude-mem + rede + provider), **não** latência pura de API; sensível à carga do host.
- **Contaminação de corpus:** o `benchmark.sh` injeta ~30–40 obs/dia no projeto `2e157557` (~1,1% do território v2) — quase-duplicatas; excluir por prompt-hash no export qualitativo.

## 6. Reprodutibilidade

- Dados: `data/benchmarks-raw.csv` (2102 runs) e `data/benchmarks-by-version.csv` (por versão×modelo×prompt).
- Recompute do controle de host: agregar `latency_ms` por `cc_version`×`hostname` filtrando `model=claude-haiku-4-5-20251001` e `prompt=infra-check`.
- Detalhes metodológicos e queries SQL: ver o doc host-confound relacionado (acima).
