# Próxima rodada — robustez estatística do painel de juízes

> Handoff 2026-06-12 noite. Estado atual: painel de 3 juízes cegos fecha **C ≈ C′ > B**
> (ver `THREE-WAY-REGIMES.md` §Panel verdict). Conclusão é direcional, **não significativa ainda**.

## O que já está pronto (não refazer)
- Amostra cega: `~/.claude-telemetry/evals/judge-sample.json` na **.100** — 30 obs orgânicas (10 B / 10 C / 10 C′, meta-pesquisa excluída).
- Harness: `judge.mjs` (Haiku, local CC) + `judge-or.mjs` (OpenRouter, **parametrizável** por `OR_MODEL`/`OR_LABEL`).
- Tabela: `claude_telemetry.eval_judge` no PG **.253** (colunas: id, created_at, obs_id, regime, judge_model, 4 dims, why, tokens, cost).
- Resultados gravados: Haiku 4.5, `nvidia/nemotron-3-ultra-550b`, `meta-llama/llama-3.3-70b`.
- CSVs versionados: `eval-judge-nemotron-20260612.csv`, `eval-judge-llama33-20260612.csv`.

## Caveats que a próxima rodada deve atacar
1. **n = 10/regime → direcional.** Subir para **30/regime** (re-amostrar `judge-sample.json` com 90 obs orgânicas, mesmo critério de exclusão de meta-pesquisa). Maior alavanca de credibilidade.
2. **Saturação de _usefulness_** (todos os juízes dão ~5) e do Nemotron inteiro. Trocar nota absoluta 1-5 por **ranking forçado** (juiz recebe um trio B/C/C′ embaralhado e ORDENA) — elimina o teto e mede preferência relativa direto.
3. **Significância:** com n=30 e/ou ranking, rodar um teste (ex.: Wilcoxon/sign test B-vs-C por par, ou contagem de "B em último" no ranking forçado). Reportar p-valor, não só média.

## Gotchas operacionais (não tropeçar de novo)
- **Chave OpenRouter VIVA**: `.100:~/.env/openrouter.env` (a do claude-mem `.253` está MORTA: 401 "User not found"). Conta tinha **$10 crédito**.
- **Nemotron-3-Ultra** é reasoning model → `/no_think` + `max_tokens=2500` (200 dá 30/30 FAIL).
- **Llama-3.3-70B `:free` é 429-throttled** (provider Venice) → usar a paga `meta-llama/llama-3.3-70b-instruct` (~$0.01/30 chamadas).
- Se reusar `OR_LABEL` entre runs, **dedup por `min(id)` por obs_id** (contaminação já aconteceu e foi limpa).

## Candidatos a 4º/5º juiz (todos OpenRouter, neutros)
- `deepseek/deepseek-chat-v3.1` ($0.21/$0.79) — forte discriminante.
- `openai/gpt-oss-120b` ($0.04/$0.18) — barato, OpenAI open.
- `qwen/qwen-2.5-72b-instruct` ($0.36/$0.40).

## Estado git (LOCAL-ONLY, preliminar — NÃO push)
Branch `data/v2-preliminary`, commits `5f229c3` (Haiku) · `e217ae2` (Nemotron) · `7a318cb` (Llama).
