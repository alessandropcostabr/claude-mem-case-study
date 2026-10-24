#!/usr/bin/env bun
// Aggregates the full forced-ranking panel: Round 2 (5 OpenRouter judges) + Round 3
// (NVIDIA NIM judges, judge_model like 'nim/%'), all on the SAME frozen 90-obs sample.
// Per judge: mean rank of B/C/C′, #B-last, and an exact one-sided binomial sign test
// p = P(X >= k_Blast | n, p0=1/3) — H0: a judge ranks B last by chance.
// Per-judge (NOT pooled — same trios judged N times violates independence).
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const bench = readFileSync(join(homedir(), '.claude-telemetry/benchmark.sh'), 'utf8');
const PG = Object.fromEntries([...bench.matchAll(/^PG_(\w+)="([^"]*)"/gm)].map(m => [m[1], m[2]]));
const q = (sql) => spawnSync('psql', ['-h', PG.HOST, '-U', PG.USER, '-d', PG.DB, '-tA', '-F', '|', '-c', sql],
  { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.PASS } }).stdout.trim();

// binomial tail: P(X >= k | n, p)
function logC(n, k) { let s = 0; for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1); return s; }
function binomGE(k, n, p) {
  let s = 0; for (let x = k; x <= n; x++) s += Math.exp(logC(n, x) + x * Math.log(p) + (n - x) * Math.log(1 - p)); return s;
}

// JUDGE_LIKE selects a panel: default excludes Round-4 (r4:%); set JUDGE_LIKE='r4:%' for Round 4.
const LIKE = process.env.JUDGE_LIKE || '';
const where = LIKE ? `where judge_model like '${LIKE}'` : `where judge_model not like 'r4:%'`;
const rows = q(`
  select judge_model,
    count(distinct trio_idx) trios,
    round(avg(rank) filter (where regime='B'),2)       b_mean,
    round(avg(rank) filter (where regime='C'),2)       c_mean,
    round(avg(rank) filter (where regime='C-prime'),2) cp_mean,
    count(*) filter (where regime='B' and rank=3)       b_last
  from eval_rank ${where} group by 1 order by judge_model like '%nim/%', judge_model
`).split('\n').filter(Boolean).map(l => {
  const [judge, trios, b, c, cp, blast] = l.split('|');
  return { judge, trios: +trios, b: +b, c: +c, cp: +cp, blast: +blast };
});

const fmt = (x) => (x < 1e-4 ? x.toExponential(1) : x.toFixed(3));
console.log('=== FULL PANEL — forced ranking (lower mean = better; chance = 2.00) ===');
console.log('judge'.padEnd(46) + 'trios  C    C′   B    B-last  sign-p');
let blastMaj = 0, sig = 0, total = 0;
for (const r of rows) {
  const p = binomGE(r.blast, r.trios, 1 / 3);
  const star = p < 0.05 ? (p < 0.01 ? ' **' : ' *') : (p < 0.1 ? ' ~' : '');
  const isNim = r.judge.startsWith('nim/');
  const pct = (100 * r.blast / r.trios).toFixed(0);
  console.log(
    (isNim ? '· ' : '  ') + r.judge.padEnd(44) +
    String(r.trios).padStart(4) + '  ' +
    r.c.toFixed(2) + ' ' + r.cp.toFixed(2) + ' ' + r.b.toFixed(2) + '  ' +
    (r.blast + '/' + r.trios).padStart(6) + ' ' + pct + '%  ' + fmt(p) + star
  );
  total++; if (r.blast / r.trios > 1 / 3) blastMaj++; if (p < 0.05) sig++;
}
console.log(`\nJudges ranking B worst-than-chance: ${blastMaj}/${total} · significant (p<0.05): ${sig}/${total}`);
console.log('(legend: ** p<0.01, * p<0.05, ~ p<0.10; · = NVIDIA NIM judge, Round 3)');
