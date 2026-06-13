#!/usr/bin/env bun
// Neutral blind judge via OpenRouter (NVIDIA Nemotron-3-Ultra). Same rubric and
// sample as the Haiku judge, but Nemotron generates NONE of the regimes → no
// self-preference. Runs on .100 (OpenRouter key); writes claude_telemetry.eval_judge (.253).
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const KEY = (readFileSync(join(homedir(), '.env/openrouter.env'), 'utf8').match(/sk-or-v1-[A-Za-z0-9_-]+/) || [])[0];
const sample = JSON.parse(readFileSync(join(homedir(), '.claude-telemetry/evals/judge-sample.json'), 'utf8'));
const bench = readFileSync(join(homedir(), '.claude-telemetry/benchmark.sh'), 'utf8');
const PG = Object.fromEntries([...bench.matchAll(/^PG_(\w+)="([^"]*)"/gm)].map(m => [m[1], m[2]]));

const RUBRIC = `You are grading the QUALITY of a single engineering "memory note" a coding session saved about its own work. You do NOT have the codebase, so DO NOT judge factual accuracy — judge quality SIGNALS from the text alone. Score each 1-5 (5=best):
- groundedness: cites specific checkable anchors (file:line, paths, identifiers, counts, commit hashes) vs vague claims.
- specificity: concrete and precise vs generic.
- calibration: appropriately confident — flags assumptions/uncertainty where warranted, not overconfident.
- usefulness: would help a future session avoid re-discovering or re-deciding this.
Return ONLY a compact JSON object, no prose: {"groundedness":N,"specificity":N,"calibration":N,"usefulness":N,"why":"<=12 words"}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function judge(content) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 100000);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 2500, temperature: 0,
          messages: [{ role: 'user', content: `/no_think\n${RUBRIC}\n\n--- NOTE ---\n${content}` }] }),
      });
      clearTimeout(to);
      if (res.status === 429) { await sleep(8000); continue; }
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content || '';
      const m = text.match(/\{[^{}]*"groundedness"[^{}]*\}/s);
      return m ? JSON.parse(m[0]) : null;
    } catch (e) { await sleep(3000); }
  }
  return null;
}

function pgInsert(row) {
  const cols = Object.keys(row).join(',');
  const vals = Object.values(row).map(v => v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''").slice(0, 300)}'`).join(',');
  spawnSync('psql', ['-h', PG.HOST, '-U', PG.USER, '-d', PG.DB, '-q', '-c', `insert into eval_judge (${cols}) values (${vals})`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.PASS } });
}

const agg = {};
console.log(`neutral judge=${MODEL} · n=${sample.length}`);
sample.sort((a, b) => (a.id < b.id ? -1 : 1));
for (const o of sample) {
  const s = await judge(o.content);
  if (!s) { console.log(`  [${o.regime}] ${o.id.slice(0, 8)} — FAIL`); continue; }
  pgInsert({ obs_id: o.id, regime: o.regime, judge_model: 'nvidia/nemotron-3-ultra-550b',
    groundedness: s.groundedness | 0, specificity: s.specificity | 0, calibration: s.calibration | 0,
    usefulness: s.usefulness | 0, why: s.why || '', input_tokens: 0, output_tokens: 0, cost: 0 });
  (agg[o.regime] ||= []).push(s);
  console.log(`  [${o.regime.padEnd(7)}] ${o.id.slice(0, 8)} g=${s.groundedness} s=${s.specificity} c=${s.calibration} u=${s.usefulness}`);
  await sleep(2000);
}
console.log('\n=== NEUTRAL judge aggregate (avg per regime) ===');
const dims = ['groundedness', 'specificity', 'calibration', 'usefulness'];
for (const reg of Object.keys(agg)) {
  const rows = agg[reg];
  const m = dims.map(d => (rows.reduce((s, r) => s + (r[d] | 0), 0) / rows.length).toFixed(2));
  console.log(`  ${reg.padEnd(8)} (n=${rows.length}): g=${m[0]} s=${m[1]} c=${m[2]} u=${m[3]} | OVERALL=${(m.reduce((s, x) => s + +x, 0) / 4).toFixed(2)}`);
}
