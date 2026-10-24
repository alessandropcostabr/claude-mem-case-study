# Evolução do Claude Code por versão — latência e output (v2)

**Data:** 24/out/2026 — **dataset final (pesquisa encerrada em 24/out)**
**Fonte:** `claude_telemetry.benchmarks` @ .253 (**7.947 runs**, 15/abr → 24/out) — agregado em `data/benchmarks-raw.csv` / `data/benchmarks-by-version.csv`
**Relaciona/estende:** `~/.claude/claude-mem-comparativo/PESQUISA-2026-06-10-latencia-host-confound.md`
**Histórico:** versão anterior deste doc (16/jun, 2.102 runs, até 2.1.178) concluía "melhora de ~40% e estável" — **os dados completos corrigem isso** (ver TL;DR 1 e §1).

> ⚠️ **Caveat que enquadra todo este doc:** a latência ponta-a-ponta do CC é **dominada por carga de host** e inclui o backend do provider. Sem controlar o host, versão e host ficam **confundidos**. `latency_ms` = wall-clock do `claude --print` inteiro, não latência pura de API. Não use isto como prova de "regressão/ganho por versão" sem as ressalvas.

---

## TL;DR

1. **🔄 CORREÇÃO vs jun:** a melhora comemorada em jun (hosts limpos a ~12k ms em jun/jul) foi um **mínimo local, não um platô**. Com os dados até out, a latência em hosts limpos faz uma **curva em U**: 23k (abr) → ~12k (jun/jul) → **~17k (ago–out)**. A afirmação de jun "estável desde 2.1.144" **não se sustenta** no dataset completo.
2. **🟢 Achado mais forte da série:** a subida de ago→out aparece em **DarkStarII E mach10 em paralelo** (dois hosts limpos independentes). Por ser replicada, é o sinal **menos confundido com host** que a pesquisa já teve — provável efeito de versão e/ou de backend do provider, não de carga de uma máquina.
3. **Output tokens seguem estáveis (~370–465, média ~410)** em todas as versões → o modelo **não piorou em qualidade**; o que varia é wall-clock.
4. **Confounder de host confirmado e CRESCENTE:** a HyperII/.100 segue 5×–11× mais lenta na mesma versão, e **piorou** no tempo (62k abr → 147k set → 109k out), consistente com acúmulo de carga.
5. **Novo — comparação entre modelos** (ago→out, hosts limpos, `infra-check`): opus-4-8 é o **mais rápido** (13,1k ms) apesar de mais cache; haiku-4-5 o mais lento (16,8k). Qualidade≠velocidade pela ordem esperada.

## 1. Latência em hosts limpos (DarkStarII+mach10, Haiku, `infra-check`) — a curva em U

Tendência mensal (a leitura mais honesta, porque agrega todas as versões do mês nos dois hosts limpos):

| Mês | DarkStarII | mach10 | média limpa |
|---|---|---|---|
| 2026-04 | 23.098 | 23.221 | ~23.200 ms |
| 2026-05 | 17.111 | 16.463 | ~16.800 ms |
| 2026-06 | 12.029 | 12.179 | **~12.100 ms (mínimo)** |
| 2026-07 | 11.656 | 13.099 | ~12.400 ms |
| 2026-08 | 19.428 | 16.145 | ~17.800 ms |
| 2026-09 | 16.034 | 15.037 | ~15.500 ms |
| 2026-10 | 17.779 | 16.965 | ~17.400 ms |

→ melhora real abr→jul (−48%), depois **regressão jul→out** de volta a ~17k (+42% sobre o mínimo). Líquido vs baseline abr: ainda ~25% melhor, mas **longe do platô de 12k** que jun projetou. A subida sincronizada nos dois hosts é o ponto central do §2.

Por versão (hosts limpos, n≥15), as versões recentes que puxaram a média para cima: 2.1.215 (17,6k), 2.1.220 (17,8k), 2.1.292 (18,0k), 2.1.296 (19,6k) — contra o fundo de 2.1.161 (11,5k) / 2.1.178 (11,6k).

## 2. Confounder de host (mesma versão, hosts diferentes) — confirmado e crescente

| Versão | hosts limpos | HyperII (.100) | n HyperII | penalidade |
|---|---|---|---|---|
| 2.1.144 | 13.343 | 47.407 | 21 | **3,6×** |
| 2.1.163 | 11.709 | 100.236 | 19 | **8,6×** |
| 2.1.198 | 12.086 | 116.605 | 67 | **9,6×** |
| 2.1.219 | 11.650 | 131.334 | 280 | **11,3×** |
| 2.1.296 | 19.624 | 106.081 | 44 | **5,4×** |

A penalidade da HyperII **cresceu** (3,6× em abr → 11× em jul/2.1.219) e segue dominante — **efeito de host, isolado da versão**. A queda aparente para 5,4× em 2.1.296 é porque o *host limpo também subiu* (numerador), não porque a HyperII melhorou.

**Por que a §1 é mais defensável que antes:** a subida de ago→out está nos **dois** hosts limpos ao mesmo tempo. Isso NÃO é o confounder de máquina (que afeta um host só) — é um efeito comum no tempo. Não dá pra cravar se é a versão do CC ou o backend do provider (wall-clock inclui os dois), mas **é um sinal real, não artefato de host**.

## 3. Output tokens estável (não-degradação de qualidade)

Média por versão oscila em **370–465** (centro ~410) ao longo de ~90 versões e 6 meses, sem tendência. O volume de saída para o mesmo prompt é constante → o modelo não ficou "mais burro"; a variação é toda de wall-clock. **Insight original mantido.**

## 4. Comparação entre modelos (novo — ago→out, hosts limpos, `infra-check`)

| Modelo | runs | latência média | output médio | cache_creation médio |
|---|---|---|---|---|
| claude-opus-4-8 | 605 | **13.057 ms** | 314 | 38.527 |
| claude-opus-4-6 | 606 | 15.135 ms | 242 | 26.922 |
| claude-haiku-4-5 | 610 | 16.836 ms | 417 | 25.218 |

Contra-intuitivo: **opus-4-8 é o mais rápido** apesar de maior cache_creation. A velocidade de wall-clock não segue a ordem de capacidade/custo dos modelos. (A .100 também mediu `claude-fable-5`, com os mesmos caveats de host.)

## 5. O que NÃO se pode concluir

- A melhora de latência **não é monotônica nem permanente** — tem mínimo em jun/jul e regride depois.
- **Não** dá pra isolar "versão" de "backend do provider" na subida ago→out (wall-clock inclui ambos); só dá pra dizer que **não é carga de host** (replicada em 2 hosts limpos).
- HyperII continua sem baseline 2.1.89 próprio → comparar "vs 2.1.89" nela reintroduz o confounder.

## 6. Threats to validity

- **Confounding host×versão** (central — §2); mitigado só onde há 2 hosts limpos medindo a mesma janela.
- **n variável** por versão/host; algumas células de versão única têm n baixo.
- `latency_ms` = wall-clock ponta-a-ponta (boot CC + hooks claude-mem + rede + **provider**), não latência de API.
- **Contaminação de corpus:** o `benchmark.sh` injetava ~30–40 obs/dia no projeto `2e157557`; com o **encerramento da coleta em 24/out, a contaminação para de crescer** (congela no acumulado). Excluir por prompt-hash no export qualitativo segue recomendado.

## 7. Reprodutibilidade

- Dados: `data/benchmarks-raw.csv` (7.947 runs) e `data/benchmarks-by-version.csv` (por versão×modelo×prompt). Regenerados em 24/out via `data/export-benchmarks.sh`.
- Controle de host: agregar `latency_ms` por `cc_version`×`hostname` (ou por mês×hostname) filtrando `llm_model LIKE '%haiku%'` e `prompt_id='infra-check'`.
- Coleta **encerrada em 24/out/2026** (crons+hooks+cc-exporter desligados nas 3 máquinas); dados históricos preservados no PG. Ver `~/.claude/.../memory/project_cc_telemetry.md`.
