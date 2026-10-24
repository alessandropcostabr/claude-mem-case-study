#!/usr/bin/env bun
// Round 3 — forced-ranking blind judge via NVIDIA NIM (integrate.api.nvidia.com).
// Same frozen 90-obs sample, same rubric, same deterministic trio permutation as
// judge-rank.mjs (OpenRouter) — only the backend/key change, so the NVIDIA judges are
// directly comparable to the Round-2 panel and just ADD votes to eval_rank.
// Free-tier aware: exponential backoff on 429, per-model rate-limit counters, and an
// early-abort if a model rate-limits hard. Writes claude_telemetry.eval_rank (.253)
// with judge_model = 'nim/<model>'.
//
// Usage:  MODEL=meta/llama-4-maverick-17b-128e-instruct LIMIT=1 bun judge-rank-nim.mjs   (smoke)
//         MODEL=... bun judge-rank-nim.mjs                                                (full 30)
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MODEL = process.env.MODEL || 'meta/llama-4-maverick-17b-128e-instruct';
const PREFIX = process.env.LABEL_PREFIX || '';
const LABEL = process.env.LABEL || `${PREFIX}nim/${MODEL}`;
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const SAMPLE_FILE = process.env.SAMPLE_FILE || 'claude-mem-case-study/data/v2/judge-sample-90.json';
const KEY = (readFileSync(join(homedir(), '.env/.nvidia'), 'utf8').match(/nvapi-[A-Za-z0-9_-]+/) || [])[0];
if (!KEY) { console.error('no nvapi- key in ~/.env/.nvidia'); process.exit(1); }
const sample = JSON.parse(readFileSync(join(homedir(), SAMPLE_FILE), 'utf8'));
const bench = readFileSync(join(homedir(), '.claude-telemetry/benchmark.sh'), 'utf8');
const PG = Object.fromEntries([...bench.matchAll(/^PG_(\w+)="([^"]*)"/gm)].map(m => [m[1], m[2]]));

const byReg = r => sample.filter(o => o.regime === r);
const B = byReg('B'), C = byReg('C'), CP = byReg('C-prime');
const N = Math.min(B.length, C.length, CP.length, LIMIT);
const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

const RUBRIC = `You are ranking THREE engineering "memory notes" that different coding sessions saved about their own work. You do NOT have the codebase, so judge QUALITY SIGNALS from the text alone: groundedness (specific checkable anchors — file:line, paths, ids, counts, hashes), specificity, calibration (flags uncertainty, not overconfident), and usefulness to a FUTURE session. You MUST produce a strict ranking, no ties.
Output ONLY compact JSON: {"ranking":[best,middle,worst],"why":"<=15 words"} where each entry is the note number 1, 2 or 3.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = { rl: 0, fail: 0, ok: 0 }; // rate-limit hits, parse/other fails, successes

async function rank(notes) {
  const body = notes.map(x => `--- NOTE ${x.n} ---\n${x.text}`).join('\n\n');
  for (let a = 0; a < 5; a++) {
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 2500, temperature: 0,
          messages: [{ role: 'user', content: `/no_think\n${RUBRIC}\n\n${body}` }] }),
      });
      clearTimeout(to);
      if (res.status === 429 || res.status === 503) { stats.rl++; await sleep(8000 * (a + 1)); continue; } // backoff grows
      if (res.status === 401 || res.status === 403) { console.error(`\n  AUTH/QUOTA ${res.status}: ${(await res.text()).slice(0,160)}`); return { authfail: true }; }
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content || '';
      const m = text.match(/\{[^{}]*"ranking"[^{}]*\}/s);
      if (!m) { await sleep(2000); continue; }
      const parsed = JSON.parse(m[0]);
      const rk = (parsed.ranking || []).map(Number).filter(x => x >= 1 && x <= 3);
      if (new Set(rk).size !== 3) continue;
      return { rk, why: parsed.why || '' };
    } catch { await sleep(3000); }
  }
  return null;
}

function pgInsert(rows) {
  const values = rows.map(r => `(${[`'${LABEL}'`, r.trio, `'${r.regime}'`, `'${r.obs}'`, r.rank, `'${(r.why||'').replace(/'/g,"''").slice(0,200)}'`].join(',')})`).join(',');
  const out = spawnSync('psql', ['-h', PG.HOST, '-U', PG.USER, '-d', PG.DB, '-q', '-c',
    `insert into eval_rank (judge_model,trio_idx,regime,obs_id,rank,why) values ${values}`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.PASS } });
  if (out.status !== 0) console.error('  PG insert error:', (out.stderr||'').trim().slice(0,160));
}

console.log(`[NIM] forced-rank judge=${LABEL} · trios=${N}${LIMIT!==Infinity?` (LIMIT=${LIMIT})`:''}`);
const rankSum = { B: 0, C: 0, 'C-prime': 0 }, lastCount = { B: 0, C: 0, 'C-prime': 0 }, firstCount = { B: 0, C: 0, 'C-prime': 0 };
let done = 0, consecRL = 0;
for (let i = 0; i < N; i++) {
  const trio = [B[i], C[i], CP[i]];
  const perm = PERMS[i % 6];
  const shown = perm.map((srcIdx, pos) => ({ n: pos + 1, srcIdx, text: trio[srcIdx].content }));
  const before = stats.rl;
  const r = await rank(shown);
  if (r?.authfail) { console.log('  ABORT — auth/quota failure'); break; }
  if (stats.rl > before) consecRL++; else consecRL = 0;
  if (consecRL >= 4) { console.log(`  ABORT — ${consecRL} consecutive rate-limited trios (free-tier limit hit)`); break; }
  if (!r) { stats.fail++; console.log(`  trio ${i} — FAIL (no parse)`); continue; }
  stats.ok++;
  const noteToSrc = {}; shown.forEach(x => noteToSrc[x.n] = x.srcIdx);
  const regOf = src => ['B','C','C-prime'][src];
  const rows = r.rk.map((noteNum, rankPos) => {
    const src = noteToSrc[noteNum]; const reg = regOf(src);
    rankSum[reg] += rankPos + 1; if (rankPos === 0) firstCount[reg]++; if (rankPos === 2) lastCount[reg]++;
    return { trio: i, regime: reg, obs: trio[src].id, rank: rankPos + 1, why: r.why };
  });
  pgInsert(rows); done++;
  console.log(`  trio ${i}: best=${regOf(noteToSrc[r.rk[0]])} mid=${regOf(noteToSrc[r.rk[1]])} worst=${regOf(noteToSrc[r.rk[2]])}  [rl=${stats.rl}]`);
  await sleep(2500); // gentle on free tier
}
console.log(`\n=== ${LABEL} — aggregate (${done}/${N}) — lower mean rank = better ===`);
for (const reg of ['C','C-prime','B'])
  done && console.log(`  ${reg.padEnd(8)} mean_rank=${(rankSum[reg]/done).toFixed(2)}  #1st=${firstCount[reg]}  #last=${lastCount[reg]}`);
done && console.log(`  B-last = ${lastCount.B}/${done} = ${(100*lastCount.B/done).toFixed(0)}%`);
console.log(`  [limits] rate-limit-hits=${stats.rl}  parse-fails=${stats.fail}  ok=${stats.ok}`);
