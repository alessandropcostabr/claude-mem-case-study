# Memory Utility Eval — SPEC (LATE downstream utility)

Goal: replace the standing PROXY caveat with a **causal** number — does an injected LATE memory actually change
the outcome of a fresh session? Since every real session already uses c-mem, there is no natural "no-memory"
control; the only clean counterfactual is a **controlled sandbox** (Option C).

## Design (reuses `~/.claude-telemetry/evals/run-eval.mjs`)
Each task is a LATE question whose correct answer depends on a NON-OBVIOUS fact that lives in a past observation.
Run each task under conditions, machine-check the answer, log to `claude_telemetry.evals` (add a `condition`
column or reuse `family`). Manipulated variable = what memory (if any) is prepended to the prompt.

**Conditions per task:**
- `control` — prompt alone (naive session).
- `distractor` — prompt + an IRRELEVANT LATE memory (controls for "having any context block").
- `mem-C` — prompt + the grounded Stop-regime note (the real memory).
- (v2) `mem-Carc` / `mem-B` — the arc-abstract and pipeline renderings of the same fact, for regime comparison.

**Outcome metrics (already captured by the harness):** `passed` (regex hit the correct gotcha), `output_tokens`,
`latency_ms`, `gave_up`. **Memory lift = pass-rate(mem-C) − pass-rate(control)**; regime lift = mem-C vs mem-Carc
vs mem-B. Token/latency deltas capture SPEEDUP even when both conditions eventually pass.

**Models:** opus-4-8, opus-4-6, haiku-4-5 (control). Reps: ≥5/condition/model. Hard token cap (harness has it).

## Candidate tasks (real LATE gotchas — each has a backing memory)
| id | prompt (naive answer is WRONG) | correct answer requires memory | check |
|---|---|---|---|
| `jest-not-ci` | "O CI do LATE está verde. Posso declarar o PR pronto pra merge?" | NÃO — jest backend não é check do CI (só vitest/E2E); rodar `npm test` local antes | mentions jest∉CI / run local |
| `redis-scriptload` | "Envolvi o `sendCommand` do RedisStore num timeout de 1s pra evitar hang. Risco?" | SIM — rate-limit-redis dispara SCRIPT LOAD no construtor sem `.catch` → timeout vira unhandledRejection → crash no boot; precisa catch no-op | mentions unhandledRejection / crash-on-boot / catch |
| `capture-open-stage` | "Vou criar a opp de captura no 1º estágio do pipeline (`getFirstStage`). OK?" | NÃO — dedup só vê `is_closed=FALSE`; 1º estágio fechado → duplicata; usar `getFirstOpenStage` | mentions estágio aberto / is_closed / duplicata |
| `gate6-fallback` | "Meu comentário diz 'removi o fallback silencioso' e o Gate 6 rejeitou. Por quê?" | Gate 6 bane a palavra 'fallback' em qualquer linha de código, mesmo negando; reescrever sem a palavra | mentions gate bane palavra / reescrever comentário |
| `dnsmasq-bak` | "Vou salvar `dnsmasq.conf.bak` dentro de `/etc/dnsmasq.d/`. Problema?" | SIM — o dir lê TODOS os arquivos como config (exceto `.dpkg-*`); `.bak` quebra o dnsmasq; salvar fora | mentions dir lê tudo / quebra / fora do dir |
| `win-settings-bom` | "Vou editar `~/.claude-mem/settings.json` no Windows com o Edit tool." | Injeta BOM → corrompe silenciosamente; usar `node -e` | mentions BOM / corrompe / node -e |

Selection rationale: each is (a) backed by a real observation, (b) NON-obvious (a naive session plausibly gives
the wrong/confident answer), (c) objectively checkable. Pure-recall/reasoning → no code fixture needed.
A model that gets it right WITHOUT the memory simply shows zero lift there (measures redundancy, not failure).

## What this measures — and its honest limits
- MEASURES: the causal effect of injecting a known LATE gotcha on a fresh session's correctness/speed.
- DOES NOT measure: the *organic* value of memory (the gotcha you didn't know you'd need) — that needs the
  natural "empty-injection" quasi-experiment or a human-rating layer (Option E), listed as follow-ups.
- Curated tasks ⇒ selection bias toward facts we already know matter; report it.

## Build steps (once task set is confirmed)
1. `run-mem-eval.mjs` — fork of `run-eval.mjs`: TASKS above, CONDITIONS loop, prepend memory block per condition,
   verify() regexes, write to `evals` (+ `condition`). Token-capped.
2. Pull the real backing note per task from PG (`observations` where title matches) for `mem-C`; author the
   `distractor`; (v2) pull/author `mem-Carc`/`mem-B` variants.
3. Run ≥5 reps × 4 conditions × 3 models; aggregate pass-rate + token/latency deltas per condition.
4. Write results to `THREE-WAY-REGIMES.md` §MEMORY-UTILITY.
