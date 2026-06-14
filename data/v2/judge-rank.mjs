#!/usr/bin/env bun
// Forced-ranking blind judge. Forms 30 trios (1 B + 1 C + 1 C′ each), presents the
// three notes in a DETERMINISTICALLY-PERMUTED order (position can't leak regime), and
// asks the judge to RANK them best→worst as future-session memory notes. This removes
// the absolute-score ceiling (every judge saturated usefulness at 5) by forcing a
// relative ordering. Writes claude_telemetry.eval_rank (.253). Backend = OpenRouter.
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MODEL = process.env.OR_MODEL || 'meta-llama/llama-3.3-70b-instruct';
const LABEL = process.env.OR_LABEL || MODEL;
const KEY = (readFileSync(join(homedir(), '.env/openrouter.env'), 'utf8').match(/sk-or-v1-[A-Za-z0-9_-]+/) || [])[0];
const sample = JSON.parse(readFileSync(join(homedir(), '.claude-telemetry/evals/judge-sample-90.json'), 'utf8'));
const bench = readFileSync(join(homedir(), '.claude-telemetry/benchmark.sh'), 'utf8');
const PG = Object.fromEntries([...bench.matchAll(/^PG_(\w+)="([^"]*)"/gm)].map(m => [m[1], m[2]]));

const byReg = r => sample.filter(o => o.regime === r);
const B = byReg('B'), C = byReg('C'), CP = byReg('C-prime');
const N = Math.min(B.length, C.length, CP.length);
const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]; // 6 position perms, deterministic by trio

const RUBRIC = `You are ranking THREE engineering "memory notes" that different coding sessions saved about their own work. You do NOT have the codebase, so judge QUALITY SIGNALS from the text alone: groundedness (specific checkable anchors — file:line, paths, ids, counts, hashes), specificity, calibration (flags uncertainty, not overconfident), and usefulness to a FUTURE session. You MUST produce a strict ranking, no ties.
Output ONLY compact JSON: {"ranking":[best,middle,worst],"why":"<=15 words"} where each entry is the note number 1, 2 or 3.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rank(notes) { // notes = [{n, text}]
  const body = notes.map(x => `--- NOTE ${x.n} ---\n${x.text}`).join('\n\n');
  for (let a = 0; a < 4; a++) {
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 100000);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 2500, temperature: 0,
          messages: [{ role: 'user', content: `/no_think\n${RUBRIC}\n\n${body}` }] }),
      });
      clearTimeout(to);
      if (res.status === 429) { await sleep(8000); continue; }
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content || '';
      const m = text.match(/\{[^{}]*"ranking"[^{}]*\}/s);
      if (!m) continue;
      const parsed = JSON.parse(m[0]);
      const rk = (parsed.ranking || []).map(Number).filter(x => x >= 1 && x <= 3);
      if (new Set(rk).size !== 3) continue; // must be a strict perm of 1,2,3
      return { rk, why: parsed.why || '' };
    } catch { await sleep(3000); }
  }
  return null;
}

function pgInsert(rows) {
  const values = rows.map(r => `(${[`'${LABEL}'`, r.trio, `'${r.regime}'`, `'${r.obs}'`, r.rank, `'${(r.why||'').replace(/'/g,"''").slice(0,200)}'`].join(',')})`).join(',');
  spawnSync('psql', ['-h', PG.HOST, '-U', PG.USER, '-d', PG.DB, '-q', '-c',
    `insert into eval_rank (judge_model,trio_idx,regime,obs_id,rank,why) values ${values}`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.PASS } });
}

console.log(`forced-rank judge=${LABEL} · trios=${N}`);
const rankSum = { B: 0, C: 0, 'C-prime': 0 }, lastCount = { B: 0, C: 0, 'C-prime': 0 }, firstCount = { B: 0, C: 0, 'C-prime': 0 };
let done = 0;
for (let i = 0; i < N; i++) {
  const trio = [B[i], C[i], CP[i]];           // index 0=B,1=C,2=C′
  const perm = PERMS[i % 6];                    // deterministic position permutation
  const shown = perm.map((srcIdx, pos) => ({ n: pos + 1, srcIdx, text: trio[srcIdx].content }));
  const r = await rank(shown);
  if (!r) { console.log(`  trio ${i} — FAIL`); continue; }
  // r.rk = [bestNoteNum, midNoteNum, worstNoteNum]; map note number → srcIdx → regime
  const noteToSrc = {}; shown.forEach(x => noteToSrc[x.n] = x.srcIdx);
  const regOf = src => ['B','C','C-prime'][src];
  const rows = r.rk.map((noteNum, rankPos) => {
    const src = noteToSrc[noteNum]; const reg = regOf(src);
    rankSum[reg] += rankPos + 1; if (rankPos === 0) firstCount[reg]++; if (rankPos === 2) lastCount[reg]++;
    return { trio: i, regime: reg, obs: trio[src].id, rank: rankPos + 1, why: r.why };
  });
  pgInsert(rows); done++;
  console.log(`  trio ${i}: best=${regOf(noteToSrc[r.rk[0]])} mid=${regOf(noteToSrc[r.rk[1]])} worst=${regOf(noteToSrc[r.rk[2]])}`);
  await sleep(1500);
}
console.log(`\n=== forced-rank aggregate (${done}/${N} trios) — lower mean rank = better ===`);
for (const reg of ['C','C-prime','B'])
  console.log(`  ${reg.padEnd(8)} mean_rank=${(rankSum[reg]/done).toFixed(2)}  #1st=${firstCount[reg]}  #last=${lastCount[reg]}`);
console.log(`\nB-last rate = ${lastCount.B}/${done} = ${(100*lastCount.B/done).toFixed(0)}%`);
// sign test: P(B last) under H0=1/3. Report counts; p-value computed downstream.
