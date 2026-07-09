#!/usr/bin/env bun
// Memory Utility eval (LATE) — Option C, controlled sandbox.
// Each task is a LATE gotcha whose correct answer needs a fact from a past observation.
// Manipulated variable: which regime-rendering of that fact (if any) is prepended.
// Same FACT across mem-B/mem-C/mem-Carc; only the grounding altitude changes.
// Runs `claude --print` in an EMPTY cwd (no repo lookup → memory is the only source).
// Writes claude_telemetry.evals: task_id='memutil:<id>', family='<condition>'. Token-capped.
//
// Usage: bun run-mem-eval.mjs [reps] [model1 model2 ...]
import { spawnSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir, hostname } from 'os';
import { join } from 'path';

const REPS = parseInt(process.argv[2] || '3', 10);
const MODELS = process.argv.slice(3);
if (MODELS.length === 0) MODELS.push('claude-opus-4-8', 'claude-opus-4-6', 'claude-haiku-4-5-20251001');
const MAX_TOKENS = parseInt(process.env.CMEM_EVAL_MAX_TOKENS || '3000000', 10);
const CWD = mkdtempSync(join(tmpdir(), 'memutil-'));

const bench = spawnSync('bash', ['-c', "grep -E '^PG_(HOST|DB|USER|PASS)=' ~/.claude-telemetry/benchmark.sh"], { encoding: 'utf8' }).stdout;
const PG = Object.fromEntries([...bench.matchAll(/^PG_(\w+)="([^"]*)"/gm)].map(m => [m[1], m[2]]));
const reGiveUp = /n[ãa]o consegui|desisti|unable to|couldn'?t|n[ãa]o foi poss[íi]vel/i;

// Shared distractor: a real LATE memory, irrelevant to every task (controls for "any context block").
const DISTRACTOR = 'O campo "sexo" do pet no SimplesVet NÃO deve ser automatizado — é um bloqueio de QC benéfico; o cadastro do sexo é manual por decisão de produto.';

const TASKS = [
  {
    id: 'jest-not-ci',
    prompt: 'No projeto LATE, o CI do GitHub está todo verde no meu PR. Posso declarar o PR pronto pra merge com segurança? Responda sim/não e por quê, em 1-2 frases.',
    verify: t => /(jest|backend|npm test|testes? de backend)/i.test(t) && /(n[ãa]o (roda|é check|entra|est|faz|é execut)|fora do ci|só (vitest|frontend|e2e)|rodar.{0,15}local|n[ãa]o (garante|cobre|est[áa] cobert))/i.test(t),
    memB: 'No LATE os testes de backend não são executados pelo CI; portanto o CI verde não garante que o backend foi testado.',
    memC: "jest backend NÃO é check do CI do GitHub no LATE — os checks são Técnicos Gates, semgrep, npm audit, Frontend vitest e E2E Chromium; nenhum 'Backend Tests'. Uma regressão real passou 5 rounds de review + CI verde por isso. Sempre rodar `npm test` local antes de declarar merge-ready.",
    memCarc: 'Padrão: CI verde não implica pronto-para-merge quando a suíte de testes crítica não faz parte dos checks automatizados — confirmar quais suítes o CI realmente executa antes de confiar no verde.',
  },
  {
    id: 'redis-scriptload',
    prompt: 'No LATE, envolvi o `sendCommand` do RedisStore (rate-limit-redis) num timeout de 1s pra evitar hang quando o Redis está fora. Isso é seguro? Responda e justifique em 1-2 frases.',
    verify: t => /(unhandledrejection|crash|derruba|catch|script load|construtor|boot|rejei)/i.test(t),
    memB: 'Envolver o sendCommand do RedisStore em timeout pode causar erros não tratados que derrubam o processo quando o Redis está fora no boot.',
    memC: 'rate-limit-redis 4.3.1 dispara SCRIPT LOAD no CONSTRUTOR e guarda os promises SEM `.catch` (linhas 95-96). Com `withTimeout(1000)` no sendCommand, esses promises REJEITAM ~1s após o boot com Redis fora → unhandledRejection → Node≥15 derruba o worker. Fix: `sha.catch(()=>{})` nos 2 promises do construtor em buildRedisStore (o retryableIncrement já faz self-heal na 1ª request).',
    memCarc: 'Padrão: ao envolver promises de uma lib em timeout, verificar se a lib guarda promises sem handler em init/construtor — converter um hang em rejeição pode criar unhandledRejection (crash no boot) onde antes só havia hang.',
  },
  {
    id: 'capture-open-stage',
    prompt: 'No CRM do LATE, vou criar a oportunidade de captura no primeiro estágio do pipeline usando `getFirstStage`. Tem problema? Responda e justifique em 1-2 frases.',
    verify: t => /(aberto|is_closed|dedup|duplicat|getfirstopenstage|estágio fechado|estagio fechado)/i.test(t),
    memB: 'Criar a opp de captura no primeiro estágio pode gerar duplicatas se esse estágio estiver fechado, por causa da deduplicação.',
    memC: "No LATE a opp de captura PRECISA nascer em estágio ABERTO: o dedup `findOpenByContactAndSource` só enxerga `is_closed=FALSE`. `getFirstStage` ordena por position SEM filtrar is_closed → se o 1º estágio for fechado, cada reply vira duplicata invisível ao dedup. Usar `getFirstOpenStage` (is_closed=FALSE ORDER BY position) sob a regra requireOpenStage.",
    memCarc: 'Invariante: quem deduplica por estágio aberto tem que NASCER em estágio aberto — senão o registro fica invisível ao dedup e vira duplicata; aplicar a todo o caminho de captura, não path-a-path.',
  },
  {
    id: 'gate6-fallback',
    prompt: "No LATE, meu comentário de código diz 'sem fallback silencioso (removi a gambiarra)' e o Gate 6 do CI rejeitou o PR. Por quê e como resolvo? 1-2 frases.",
    verify: t => /(bane|banned|proib|rejeita|detecta|pega).{0,40}(palavra|fallback|termo)|reescrev|independente do contexto|mesmo (que|neg|em coment)/i.test(t),
    memB: "O Gate 6 do LATE rejeita código que contém o termo 'fallback', mesmo em comentários; reescreva sem a palavra.",
    memC: "Gate 6 (detect-legacy-compat) do LATE bane a palavra 'fallback' em QUALQUER linha de código adicionada — inclusive num comentário que NEGA o fallback. Ignora docs .md, só pega código. Fix trivial: reescrever o comentário sem a palavra 'fallback'.",
    memCarc: 'Padrão: gates de lint por palavra-chave batem no token independente do contexto/negação — um comentário que explica a REMOÇÃO de X ainda dispara o gate de X; evitar a palavra proibida mesmo ao negá-la.',
  },
  {
    id: 'dnsmasq-bak',
    prompt: 'Vou salvar um backup `dnsmasq.conf.bak` dentro de `/etc/dnsmasq.d/` antes de editar. Algum problema? 1-2 frases.',
    verify: t => /(l[êe] (tudo|todos)|carrega (tudo|todos)|todos os arquivos|quebra|falha|fora do (dir|diret)|\.dpkg|interpreta.{0,15}config|parse|config duplicad)/i.test(t),
    memB: 'Colocar um arquivo .bak no diretório do dnsmasq pode quebrar o serviço porque ele lê os arquivos do diretório.',
    memC: '`/etc/dnsmasq.d/` é lido pelo dnsmasq como config: ele carrega TODOS os arquivos do dir (exceto os que casam `.dpkg-*`), incluindo `.bak`. Um backup `.conf.bak` ali é parseado como config e QUEBRA o dnsmasq no reload. Salvar backups FORA do dir + validar com `dnsmasq --test`.',
    memCarc: 'Padrão: diretórios de config drop-in carregam TODOS os arquivos por glob — backups/.bak dentro deles viram config ativa e quebram o serviço; guardar backups fora do diretório varrido.',
  },
  {
    id: 'win-settings-bom',
    prompt: 'No Windows, vou editar `~/.claude-mem/settings.json` usando a ferramenta Edit. Ok? 1-2 frases.',
    verify: t => /(bom|byte.?order|corromp|node -e|invis[íi]vel|sem bom|codifica)/i.test(t),
    memB: 'Editar o settings.json no Windows com o Edit pode corromper o arquivo por causa de codificação (BOM).',
    memC: 'Editar `~/.claude-mem/settings.json` no Windows com a ferramenta Edit injeta um BOM (byte-order mark) no início → corrompe o JSON silenciosamente. Usar `node -e` pra reescrever o arquivo sem BOM.',
    memCarc: 'Padrão: ferramentas de edição no Windows podem injetar um BOM que corrompe parsers estritos (JSON) de forma silenciosa — preferir edição programática (node) que controla a codificação.',
  },
];

const CONDITIONS = ['control', 'distractor', 'mem-B', 'mem-C', 'mem-Carc'];
const memFor = (task, cond) => cond === 'control' ? '' : cond === 'distractor' ? DISTRACTOR
  : cond === 'mem-B' ? task.memB : cond === 'mem-C' ? task.memC : task.memCarc;

function ccVersion() { return (spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout || '?').trim().split(' ')[0]; }
function pgInsert(row) {
  const cols = Object.keys(row).join(',');
  const vals = Object.values(row).map(v => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? v : `'${String(v).replace(/'/g, "''").slice(0, 500)}'`).join(',');
  spawnSync('psql', ['-h', PG.HOST, '-U', PG.USER, '-d', PG.DB, '-q', '-c', `insert into evals (${cols}) values (${vals})`], { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.PASS } });
}

const CC = ccVersion(), HOST = hostname();
let totalTokens = 0;
console.log(`mem-util eval · host=${HOST} cc=${CC} · reps=${REPS} · models=${MODELS.join(',')} · cap=${MAX_TOKENS} · cwd=${CWD}`);
const agg = {}; // `${cond}` -> {pass, n}

outer:
for (const model of MODELS) {
  for (const task of TASKS) {
    for (const cond of CONDITIONS) {
      for (let rep = 0; rep < REPS; rep++) {
        if (totalTokens >= MAX_TOKENS) { console.log(`!! token cap (${totalTokens}) — aborting`); break outer; }
        const mem = memFor(task, cond);
        const prompt = (mem ? `<memoria-do-projeto>\n${mem}\n</memoria-do-projeto>\n\n` : '') + task.prompt;
        const t0 = Date.now();
        const r = spawnSync('claude', ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--model', model, prompt],
          { cwd: CWD, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
        const latency = Date.now() - t0;
        let text = '', u = {}, cost = 0;
        for (const line of (r.stdout || '').split('\n')) { if (!line.trim()) continue; try { const d = JSON.parse(line); if (d.type === 'result') { text = d.result || ''; u = d.usage || {}; cost = d.total_cost_usd || 0; } } catch {} }
        const inp = u.input_tokens || 0, out = u.output_tokens || 0, cc = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
        totalTokens += inp + out + cc; // exclude cache-read (cheap, dominates ctx)
        const passed = !!task.verify(text);
        const gaveUp = reGiveUp.test(text) && !passed;
        pgInsert({ hostname: HOST, cc_version: CC, llm_model: model, task_id: `memutil:${task.id}`, family: cond,
          passed, gave_up: gaveUp, adhered: true, input_tokens: inp, output_tokens: out, cache_creation_tokens: cc, cache_read_tokens: cr, latency_ms: latency, cost, detail: text.replace(/\s+/g, ' ').slice(0, 200) });
        const k = cond; agg[k] = agg[k] || { pass: 0, n: 0 }; agg[k].pass += passed ? 1 : 0; agg[k].n++;
        console.log(`  ${model.split('-').slice(1, 3).join('-').padEnd(8)} ${task.id.padEnd(18)} ${cond.padEnd(10)} ${passed ? 'PASS' : 'FAIL'} · ${out}out/${(inp + cc + cr)}ctx · ${latency}ms`);
      }
    }
  }
}
console.log(`\n=== pass-rate by condition (all models/tasks) ===`);
for (const c of CONDITIONS) if (agg[c]) console.log(`  ${c.padEnd(10)} ${agg[c].pass}/${agg[c].n} = ${(100 * agg[c].pass / agg[c].n).toFixed(0)}%`);
console.log(`total tokens: ${totalTokens}`);
