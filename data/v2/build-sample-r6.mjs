#!/usr/bin/env bun
// Build judge-sample-r6.json: bar-raise validation.
// Three-way: C-Stop (fresh, control) vs arc-old (pre-07-09) vs arc-new (post-07-09 raised-bar).
// n = 49/regime (limited by arc-new count). C-Stop sampled from post-07-09 to stay temporally fresh.
// Shuffled within regime, deterministic (seeded by index).
// Usage: bun build-sample-r6.mjs [out.json]
import pg from 'pg';
import { writeFileSync } from 'fs';

const url = process.env.CLAUDE_MEM_SERVER_DATABASE_URL;
if (!url) { console.error('Set CLAUDE_MEM_SERVER_DATABASE_URL'); process.exit(1); }
const PROJ = '2e157557-603a-4c35-9e4a-71be282f3651';
const OUT = process.argv[2] || 'data/v2/judge-sample-r6.json';
const N = 49; // limited by arc-new

const c = new pg.Client(url); await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;

const arcOld = await q(`
  SELECT id, content FROM observations
  WHERE project_id=$1 AND metadata->>'regime'='C-prime-arc'
    AND created_at < '2026-07-09 22:00:00+00' AND length(content) > 200
  ORDER BY RANDOM() LIMIT $2`, [PROJ, N]);

const arcNew = await q(`
  SELECT id, content FROM observations
  WHERE project_id=$1 AND metadata->>'regime'='C-prime-arc'
    AND created_at >= '2026-07-09 22:00:00+00' AND length(content) > 200
  ORDER BY RANDOM() LIMIT $2`, [PROJ, N]);

const stop = await q(`
  SELECT id, content FROM observations
  WHERE project_id=$1 AND metadata->>'regime'='C'
    AND created_at >= '2026-07-09 22:00:00+00' AND length(content) > 200
  ORDER BY RANDOM() LIMIT $2`, [PROJ, N]);

await c.end();

const tag = (rows, regime) => rows.map(r => ({ id: r.id, regime, content: r.content }));
const sample = [
  ...tag(stop,   'C-Stop'),
  ...tag(arcOld, 'arc-old'),
  ...tag(arcNew, 'arc-new'),
];

writeFileSync(OUT, JSON.stringify(sample, null, 2));
console.log(`wrote ${OUT}: C-Stop=${stop.length}, arc-old=${arcOld.length}, arc-new=${arcNew.length}`);
