# Pipeline integrity audit — 2026-08-14

Auditoria não planejada do regime B (pipeline) feita a partir de um incidente de
infraestrutura. Levanta três defeitos que afetam a **completude dos dados do estudo**
e produz métricas de eficiência de registro que ainda não existiam no apêndice.

Fonte: `claude_mem` @ .253 (server-beta), medições de 2026-08-13/14.
Dois PRs abertos no upstream a partir daqui: **#3583** e **#3584**.

Métricas em formato tabular: [`efficiency-metrics-20260814.csv`](./efficiency-metrics-20260814.csv).
As contagens são *snapshots* colhidos ao longo de ~12h com o sistema em operação,
então variam em unidades entre seções (ex.: eventos truncados 20.825 → 20.826).
Onde houver divergência, o CSV é a medição mais recente.

---

## 1. Sumário

| Achado | Impacto no estudo |
|---|---|
| Pipeline perdeu **19,1%** dos jobs na janela do estudo | volumetria de B subestimada |
| **190 resumos** de sessão sumiram em silêncio (bug upstream) | lacuna em B, invisível |
| Sessões densas falham por **context overflow** | viés: B não cobre as sessões maiores |
| Custo dos 40k pendentes é **38,6M tokens**, não 78,6M | correção de estimativa própria |
| Razão evento→observação = **0,81** | B não comprime — copia |
| Memória ocupa **1,5×** o volume da fonte | idem |
| C′ **fecha** o loop real-time (verificado) | resposta à crítica upstream |
| `server_session_id` NULL em **100%** das notas self-author | impede métrica pareada por sessão |

---

## 2. Perda de 19,1% no regime B durante a janela do estudo

Janela do estudo: **2026-03-09 → 2026-07-24**.

```
entregues : 131.604 agent_event + 3.722 session_summary = 135.326
perdidos  :  35.006 agent_event +    80 session_summary =  35.086
taxa de perda: 19,1% (35.086 de 183.629 jobs)
```

Causa: expiração do token OAuth. O access token vale **8h exatas**, mas quem o
renova é uma requisição da sessão Claude; sessão ociosa ⇒ token vence e toda
geração naquele intervalo leva 401. Rajadas medidas em 12–13/ago: 480, 317, 278
falhas/hora, correlacionadas 1:1 com o horário anterior a cada rotação de token.

**Atribuição — importante para não enquadrar errado:** o caminho OAuth é
customização local (`ClaudeSubscriptionObservationProvider`, header
`sk-ant-oat` → Bearer + `anthropic-beta`), **não existe no upstream**, que só
conhece `x-api-key`. Uma instalação com API key de console não tem janela de
expiração e **não exibiria essa perda**.

⚠️ Portanto: isto é **artefato do nosso setup**, não propriedade do regime B.
Apresentar os 19,1% como "vantagem estrutural do self-author" seria comparar B
na sua pior configuração possível.

### Nota de completude sugerida para o apêndice

> *Data completeness: 19.1% of pipeline generation jobs (35,086 of 183,629)
> failed during the study window, due to a subscription-OAuth integration in our
> deployment whose access token expires every 8h. This is an artifact of our
> setup, not a property of the pipeline regime — an API-key deployment would not
> exhibit it. Volume figures for B are an undercount; quality and causal results
> are unaffected, as they are computed over notes successfully produced.*

Mitigação aplicada: guard que impede enfileirar com token vencido + cron de
renovação preventiva. Perda na janela seguinte: **0**.

---

## 3. Resumos que sumiam em silêncio (bug upstream — PR #3583)

190 jobs `session_summary` presos em `queued` desde maio, **nunca** classificados
como `failed`.

Cadeia causal:

1. `generation-jobs.ts:127` — `ON CONFLICT (idempotency_key) DO UPDATE SET
   payload = payload || excluded.payload`. Todo re-create cunha um id novo em
   `$1` **e** no payload; o `ON CONFLICT` mantém a linha existente (descarta o id
   novo para a coluna `id`), mas o merge deixa esse id descartado sobrescrever
   `payload.generation_job_id`.
2. `ProviderObservationGenerator.ts:153` — o worker resolve a linha por
   `lockOutbox(payload.generation_job_id)`. Ponteiro morto ⇒ `null` ⇒ loga em
   `logger.info` (abaixo do LOG_LEVEL padrão) ⇒ **retorna `completed` ao BullMQ
   sem tocar no Postgres**.
3. `idempotency_key` deriva de `sourceId`, que para summary é a **sessão** ⇒
   colide a cada re-run. Para `agent_event` é o id do evento ⇒ nunca colide.

Medições: **190/190** divergiam; **0** divergências em ~221k `agent_event`.

**Relevância para o estudo:** as 190 sessões perdidas não são aleatórias —
146 delas têm 21+ eventos, 60.164 eventos no total, média 317/sessão, maior com
3.268. São as sessões **mais densas**. O regime B ficou sem resumo justamente
onde havia mais material.

Recuperação: corrigido o ponteiro (`jsonb_set`) + re-enfileirado ⇒ **760 resumos
recuperados**; `failed` de 774 → 48.

⚠️ A issue upstream #2459 propunha um comando de re-queue "reusando o payload
persistido" — isso **não** recupera essas linhas (replaya o ponteiro morto).
Verificado empiricamente antes de descobrir a causa.

---

## 4. Context overflow nas sessões densas (PR #3584)

Dos 48 `session_summary` que restaram em `failed`: **47 = `Anthropic context
overflow`**, e **45 dos 48 têm >100 eventos**.

`listUnprocessedEvents` limita a **contagem** (500), não o volume:

| sessão | eventos | payload | ≈ tokens |
|---|---:|---:|---:|
| c8400161 | 3.099 | 34 MB | ~9.000k |
| 0ce5b12f | 2.412 | 19 MB | ~5.011k |
| 51ed9e8b | 2.411 | 15 MB | ~4.060k |

Mesmo truncado a 500 eventos: média **634k tokens**, pior caso **1,55M** —
contra ~200k de janela. Nenhum modelo disponível absorve isso.

**Viés que isso introduz no estudo:** o regime B é avaliado apenas nas sessões
que couberam. As maiores nunca produzem nota. Se o painel de juízes amostrou
notas de B, amostrou de um subconjunto enviesado para sessões menores — o que
tende a **favorecer** B na comparação de qualidade, não prejudicá-lo.

---

## 5. Eficiência de registro (métrica nova)

Estes números são o que faltava para sustentar o argumento de eficiência em
termos que não dependem de custo.

### 5.1 O sistema não comprime

```
agent_events : 235.138 registros   1.130 MB
observations : 190.782 registros   1.696 MB
```

- **0,81 observação por evento** — praticamente 1:1, sem consolidação
- a memória ocupa **1,5× o volume da fonte** que deveria resumir

Memória maior que o registro bruto não é memória; é cópia anotada.

### 5.2 Descarte cego de sinal

O upstream trunca cada payload a `MAX_PAYLOAD_CHARS = 16 KB`
(`prompt-builder.ts:41`, do PR #2383 — **não** é customização nossa):

```
eventos truncados   : 20.825 de 235.138 (8,9%)
conteúdo descartado : 819 MB
sobrevive em média  : 51,3% do evento
pior caso           : 0,64%
```

O corte fica com os **primeiros** 16 KB. Para saída de comando ou leitura de
arquivo, o resultado costuma estar no fim — mantém-se o cabeçalho e descarta-se
o desfecho. É a heurística mais barata possível aplicada no ponto mais tardio
possível (montagem do prompt), depois de o evento já ter sido transmitido e
gravado.

### 5.3 Custo real dos 40.056 pendentes

**Correção de estimativa própria:** o cálculo inicial (78,6M tokens) usava o
payload bruto do banco e ignorava o teto de 16 KB que o código aplica.

```
custo real  : 38,6M tokens (147 MB)
custo bruto : 78,6M tokens (300 MB)  ← errado
```

E a distribuição por faixa muda de figura:

| faixa (`tool_use`) | jobs | % custo real |
|---|---:|---:|
| médio (5–20 KB) | 5.472 | **36,4%** |
| pequeno (<5 KB) | 27.624 | 29,4% |
| grande (20–100 KB) | 2.587 | 28,4% |
| gigante (>100 KB) | 536 | **5,9%** |

Os "gigantes", candidatos óbvios a corte, custam quase nada — são os mais
truncados. O peso está no volume da faixa média, não na cauda. Duplicatas
exatas: apenas **259 (0,6%)** — dedup por hash é inútil aqui.

---

## 6. C′ fecha o loop real-time (verificado)

A crítica upstream ("self-author não participa do loop de qualidade") vale para
**C** (Stop), não para **C′** (por turno). Verificação:

| requisito | estado |
|---|---|
| injeção filtra por `generation_key`? | **não** |
| join com sessões exclui notas órfãs? | **não** — `LEFT JOIN` |
| notas self-author recuperáveis? | **99,9%** com embedding (2.946/2.948) |
| C′ escreve durante a sessão? | sim, por turno |

Cobertura de embedding do self-author (99,9%) é **superior** à do pipeline
(98,2%). As notas entram no loop de recuperação como qualquer outra.

### Gap que impede a métrica pareada

**100% das 2.948 notas self-author têm `server_session_id = NULL`** (o pipeline
tem 161.075 com sessão vinculada). Não afeta a injeção, mas impede calcular por
regime:

- notas por sessão
- razão evento → nota
- bytes de fonte por byte de memória

Ou seja: a métrica de eficiência mais difícil de contestar — *"para as mesmas N
sessões, B produziu X notas e C′ produziu Y"* — **não é calculável hoje** para
C′. Os 16,3× citados vieram de contagem por janela de tempo, não pareada por
sessão.

Investigar por que o vínculo não é gravado é pré-requisito para essa métrica.

---

## 7. Ressalvas de método

- Todos os números vêm de `claude_mem` @ .253, uma única instalação. Não
  generalizam para outras instalações do claude-mem.
- A conversão para tokens usa `chars/4`, aproximação grosseira.
- A perda de 19,1% é específica do nosso acoplamento OAuth (§2) e **não** deve
  ser lida como característica do regime B.
- §5.3 corrige um erro de medição cometido nesta mesma auditoria (medir dados em
  repouso e assumir que é o que vai ao modelo, sem conferir o teto no código).
  Lição registrada: antes de dimensionar custo de LLM por volume de banco,
  verificar o que o código efetivamente envia.

---

## 8. Estado das correções

| Item | Estado |
|---|---|
| Guard de token (não enfileira vencido) | aplicado, validado em janela real (0 perdas) |
| Cron de renovação preventiva | instalado (`*/5`) |
| Ponteiro fantasma — 189 linhas | corrigido; 760 resumos recuperados |
| Ponteiro fantasma — causa no código | **PR #3583** (upstream), pendente |
| Context overflow | **PR #3584** (upstream), pendente |
| Monitoramento (`failed`, `queued_ptr_drift`) | sampler v3 + check `GEN-QUEUE` no daily-integrity |
| 40.056 `agent_event` | **não processados** — aguardando decisão |
| `server_session_id` NULL em self-author | **não investigado** |
