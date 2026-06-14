#!/usr/bin/env bun
// Forced-ranking via local claude CLI (Haiku 4.5 = the model that generates pipeline B →
// pro-B control). Same trios/permutation logic as judge-rank.mjs. Writes eval_rank.
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const JUDGE = process.env.JUDGE_MODEL || 'claude-haiku-4-5-20251001';
const LABEL = process.env.JUDGE_LABEL || JUDGE;
const sample = JSON.parse(readFileSync(join(homedir(), '.claude-telemetry/evals/judge-sample-90.json'), 'utf8'));
const bench = readFileSync(join(homedir(), '.claude-telemetry/benchmark.sh'), 'utf8');
const PG = Object.fromEntries([...bench.matchAll(/^PG_(\w+)="([^"]*)"/gm)].map(m => [m[1], m[2]]));

const byReg = r => sample.filter(o => o.regime === r);
const B = byReg('B'), C = byReg('C'), CP = byReg('C-prime');
const N = Math.min(B.length, C.length, CP.length);
const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

const RUBRIC = `You are ranking THREE engineering "memory notes" that different coding sessions saved about their own work. You do NOT have the codebase, so judge QUALITY SIGNALS from the text alone: groundedness (specific checkable anchors — file:line, paths, ids, counts, hashes), specificity, calibration (flags uncertainty, not overconfident), and usefulness to a FUTURE session. You MUST produce a strict ranking, no ties.
Output ONLY compact JSON: {"ranking":[best,middle,worst],"why":"<=15 words"} where each entry is the note number 1, 2 or 3.`;

function rank(notes) {
  const body = notes.map(x => `--- NOTE ${x.n} ---\n${x.text}`).join('\n\n');
  const r = spawnSync('claude', ['--print', '--output-format', 'stream-json', '--verbose', '--model', JUDGE,
    `${RUBRIC}\n\n${body}`], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  let text = '';
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try { const d = JSON.parse(line); if (d.type === 'result') text = d.result || ''; } catch {}
  }
  const m = text.match(/\{[^{}]*"ranking"[^{}]*\}/s);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    const rk = (p.ranking || []).map(Number).filter(x => x >= 1 && x <= 3);
    if (new Set(rk).size !== 3) return null;
    return { rk, why: p.why || '' };
  } catch { return null; }
}

function pgInsert(rows) {
  const values = rows.map(r => `('${LABEL}',${r.trio},'${r.regime}','${r.obs}',${r.rank},'${(r.why||'').replace(/'/g,"''").slice(0,200)}')`).join(',');
  spawnSync('psql', ['-h', PG.HOST, '-U', PG.USER, '-d', PG.DB, '-q', '-c',
    `insert into eval_rank (judge_model,trio_idx,regime,obs_id,rank,why) values ${values}`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.PASS } });
}

console.log(`forced-rank judge=${LABEL} (CLI) · trios=${N}`);
const rankSum = { B: 0, C: 0, 'C-prime': 0 }, lastCount = { B: 0, C: 0, 'C-prime': 0 }, firstCount = { B: 0, C: 0, 'C-prime': 0 };
let done = 0;
for (let i = 0; i < N; i++) {
  const trio = [B[i], C[i], CP[i]];
  const perm = PERMS[i % 6];
  const shown = perm.map((srcIdx, pos) => ({ n: pos + 1, srcIdx, text: trio[srcIdx].content }));
  const r = rank(shown);
  if (!r) { console.log(`  trio ${i} — FAIL`); continue; }
  const noteToSrc = {}; shown.forEach(x => noteToSrc[x.n] = x.srcIdx);
  const regOf = s => ['B','C','C-prime'][s];
  const rows = r.rk.map((noteNum, rankPos) => {
    const src = noteToSrc[noteNum]; const reg = regOf(src);
    rankSum[reg] += rankPos + 1; if (rankPos === 0) firstCount[reg]++; if (rankPos === 2) lastCount[reg]++;
    return { trio: i, regime: reg, obs: trio[src].id, rank: rankPos + 1, why: r.why };
  });
  pgInsert(rows); done++;
  console.log(`  trio ${i}: best=${regOf(noteToSrc[r.rk[0]])} mid=${regOf(noteToSrc[r.rk[1]])} worst=${regOf(noteToSrc[r.rk[2]])}`);
}
console.log(`\n=== forced-rank aggregate (${done}/${N}) — lower=better ===`);
for (const reg of ['C','C-prime','B'])
  console.log(`  ${reg.padEnd(8)} mean_rank=${(rankSum[reg]/done).toFixed(2)}  #1st=${firstCount[reg]}  #last=${lastCount[reg]}`);
console.log(`\nB-last rate = ${lastCount.B}/${done} = ${(100*lastCount.B/done).toFixed(0)}%`);
