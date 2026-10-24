#!/usr/bin/env bun
// Round 6 — bar-raise validation via forced-ranking blind judge (OpenRouter/NIM).
// Three-way: C-Stop (control) vs arc-old (pre-07-09 prompt) vs arc-new (post-07-09 raised-bar).
// Question: did the raised-bar deployment improve per-obs quality of the arc regime?
// Same rubric and permutation logic as R5. Writes eval_rank with judge_model='r6:<label>'.
//
// Usage:
//   OR_MODEL=google/gemma-3-27b-it OR_LABEL=gemma-3-27b LIMIT=1 bun judge-rank-r6.mjs   (smoke)
//   OR_MODEL=google/gemma-3-27b-it OR_LABEL=gemma-3-27b bun judge-rank-r6.mjs             (full)
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MODEL   = process.env.OR_MODEL  || 'google/gemma-3-27b-it';
const ORLABEL = process.env.OR_LABEL  || MODEL.split('/').pop();
const LABEL   = `r6:${ORLABEL}`;
const LIMIT   = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const SAMPLE  = process.env.SAMPLE_FILE || join(homedir(), 'claude-mem-case-study/data/v2/judge-sample-r6.json');

const OR_KEY  = (readFileSync(join(homedir(), '.env/openrouter.env'), 'utf8').match(/sk-or-v1-[A-Za-z0-9_-]+/) || [])[0];
if (!OR_KEY) { console.error('no sk-or- key in ~/.env/.openrouter'); process.exit(1); }

const bench = readFileSync(join(homedir(), '.claude-telemetry/benchmark.sh'), 'utf8');
const PG = Object.fromEntries([...bench.matchAll(/^PG_(\w+)="([^"]*)"/gm)].map(m => [m[1], m[2]]));

const sample = JSON.parse(readFileSync(SAMPLE, 'utf8'));
const byReg  = r => sample.filter(o => o.regime === r);
const STOP   = byReg('C-Stop');
const OLD    = byReg('arc-old');
const NEW    = byReg('arc-new');
const N      = Math.min(STOP.length, OLD.length, NEW.length, LIMIT);
const PERMS  = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const REGIMES = ['C-Stop', 'arc-old', 'arc-new'];

const RUBRIC = `You are ranking THREE engineering "memory notes" that different coding sessions saved about their own work. You do NOT have the codebase, so judge QUALITY SIGNALS from the text alone: groundedness (specific checkable anchors — file:line, paths, ids, counts, hashes), specificity, calibration (flags uncertainty, not overconfident), and usefulness to a FUTURE session. You MUST produce a strict ranking, no ties.
Output ONLY compact JSON: {"ranking":[best,middle,worst],"why":"<=15 words"} where each entry is the note number 1, 2 or 3.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = { rl: 0, fail: 0, ok: 0 };

async function rank(notes) {
  const body = notes.map(x => `--- NOTE ${x.n} ---\n${x.text}`).join('\n\n');
  for (let a = 0; a < 5; a++) {
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/claudiodangelis/claude-mem', 'X-Title': 'claude-mem-judge' },
        // ponytail: /no_think + 2500 tokens for reasoning models (nemotron, deepseek-r*)
        const isReasoning = MODEL.includes('nemotron') || MODEL.includes('-r1') || MODEL.includes('-r2');
        const prompt = isReasoning ? `/no_think\n${RUBRIC}\n\n${body}` : `${RUBRIC}\n\n${body}`;
        body: JSON.stringify({ model: MODEL, max_tokens: isReasoning ? 2500 : 400, temperature: 0,
          messages: [{ role: 'user', content: prompt }] }),
      });
      clearTimeout(to);
      if (res.status === 429 || res.status === 503) { stats.rl++; await sleep(8000 * (a + 1)); continue; }
      if (res.status === 401 || res.status === 403) { console.error(`AUTH ${res.status}: ${(await res.text()).slice(0,160)}`); return { authfail: true }; }
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content || '';
      const m = text.match(/\{[^{}]*"ranking"[^{}]*\}/s);
      if (!m) { stats.fail++; await sleep(2000); continue; }
      const parsed = JSON.parse(m[0]);
      const rk = (parsed.ranking || []).map(Number).filter(x => x >= 1 && x <= 3);
      if (new Set(rk).size !== 3) { stats.fail++; continue; }
      return { rk, why: parsed.why || '' };
    } catch { await sleep(3000); }
  }
  stats.fail++; return null;
}

function pgInsert(rows) {
  const vals = rows.map(r =>
    `('${LABEL}',${r.trio},'${r.regime}','${r.obs}',${r.rank},'${(r.why||'').replace(/'/g,"''").slice(0,200)}')`
  ).join(',');
  const out = spawnSync('psql', ['-h', PG.HOST, '-U', PG.USER, '-d', PG.DB, '-q', '-c',
    `insert into eval_rank (judge_model,trio_idx,regime,obs_id,rank,why) values ${vals}`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.PASS } });
  if (out.status !== 0) console.error('PG error:', (out.stderr||'').trim().slice(0,160));
}

const rankSum = Object.fromEntries(REGIMES.map(r => [r, 0]));
const first   = Object.fromEntries(REGIMES.map(r => [r, 0]));
const last    = Object.fromEntries(REGIMES.map(r => [r, 0]));

console.log(`[R6] judge=${LABEL} · n/regime=${N} · trios=${N}`);
let done = 0, consecRL = 0;

for (let i = 0; i < N; i++) {
  const trio = [STOP[i], OLD[i], NEW[i]];
  const perm = PERMS[i % 6];
  const shown = perm.map((src, pos) => ({ n: pos + 1, src, text: trio[src].content }));
  const prevRL = stats.rl;
  const r = await rank(shown);
  if (r?.authfail) { console.log('ABORT — auth failure'); break; }
  if (stats.rl > prevRL) consecRL++; else consecRL = 0;
  if (consecRL >= 4) { console.log('ABORT — rate-limit burst'); break; }
  if (!r) { console.log(`  trio ${i} — FAIL`); continue; }
  stats.ok++;
  const noteToSrc = {}; shown.forEach(x => noteToSrc[x.n] = x.src);
  const rows = r.rk.map((noteNum, rankPos) => {
    const src = noteToSrc[noteNum]; const reg = REGIMES[src];
    rankSum[reg] += rankPos + 1;
    if (rankPos === 0) first[reg]++;
    if (rankPos === 2) last[reg]++;
    return { trio: i, regime: reg, obs: trio[src].id, rank: rankPos + 1, why: r.why };
  });
  pgInsert(rows); done++;
  console.log(`  trio ${i}: best=${REGIMES[noteToSrc[r.rk[0]]]} mid=${REGIMES[noteToSrc[r.rk[1]]]} worst=${REGIMES[noteToSrc[r.rk[2]]]}  [rl=${stats.rl}]`);
  await sleep(2000);
}

console.log(`\n=== ${LABEL} — ${done}/${N} trios (lower = better) ===`);
for (const reg of REGIMES)
  done && console.log(`  ${reg.padEnd(10)} mean=${(rankSum[reg]/done).toFixed(2)}  #best=${first[reg]}  #worst=${last[reg]}`);
console.log(`  [rl=${stats.rl} fail=${stats.fail} ok=${stats.ok}]`);
