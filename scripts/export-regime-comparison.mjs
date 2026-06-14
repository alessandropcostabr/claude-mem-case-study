#!/usr/bin/env bun
// Export Regime B (pipeline 1->LLM) vs Regime C (self-author) comparison datasets.
// claude-mem case study v2. Reads server-beta Postgres. Writes CSVs to data/v2/.
//
// Usage (on the server-beta host, .253):
//   set -a; . ~/.claude-mem/.env-server-beta; set +a
//   bun scripts/export-regime-comparison.mjs [outDir]
//
// Discriminator: generation_key IS NULL => self-author (Regime C); non-null => pipeline.
import pg from "pg";
import { mkdirSync, writeFileSync } from "fs";

const url = process.env.CLAUDE_MEM_SERVER_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("Set CLAUDE_MEM_SERVER_DATABASE_URL"); process.exit(2); }
const PROJ = process.env.CMEM_PROJECT_ID || "2e157557-603a-4c35-9e4a-71be282f3651";
const SINCE = process.env.CMEM_WINDOW_SINCE || "2026-06-10 22:00:00+00"; // first self-author burst
const OUT = process.argv[2] || "data/v2";

const c = new pg.Client(url); await c.connect();
mkdirSync(OUT, { recursive: true });
const q = async (sql, p) => (await c.query(sql, p)).rows;
const csv = (rows, cols) => [cols.join(","), ...rows.map(r => cols.map(k => {
  const s = String(r[k] ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}).join(","))].join("\n") + "\n";

// 1) Daily volumetry, full project history
const daily = await q(
  `select to_char(created_at at time zone 'UTC','YYYY-MM-DD') date,
          count(*) filter (where generation_key is null) self_authored,
          count(*) filter (where generation_key is not null) pipeline,
          count(*) total
   from observations where project_id=$1 group by 1 order by 1`, [PROJ]);
writeFileSync(`${OUT}/regime-daily-volumetry.csv`, csv(daily, ["date","self_authored","pipeline","total"]));

// 2) Headline comparison metrics (in-window)
const base = await q(
  `select generation_key is null sa, count(*) n, round(avg(length(content))) avg_chars,
          count(distinct metadata->>'title') distinct_titles
   from observations where project_id=$1 and created_at>=$2 group by 1`, [PROJ, SINCE]);
const re = "corre|impreci|falso|EXISTE|defasad|encolheu| NAO | nao ";
const metaSA = (await q(`select count(*) n from observations where project_id=$1 and created_at>=$2 and generation_key is null and metadata->>'title' ~* $3`, [PROJ, SINCE, re]))[0].n;
const metaPP = (await q(`select count(*) n from observations where project_id=$1 and created_at>=$2 and generation_key is not null and metadata->>'title' ~* $3`, [PROJ, SINCE, re]))[0].n;
const pp = base.find(r => !r.sa), sa = base.find(r => r.sa);
writeFileSync(`${OUT}/regime-comparison-metrics.csv`, csv([
  { metric: "observations", pipeline_1to1llm: pp.n, self_author: sa.n },
  { metric: "avg_chars", pipeline_1to1llm: pp.avg_chars, self_author: sa.avg_chars },
  { metric: "distinct_titles", pipeline_1to1llm: pp.distinct_titles, self_author: sa.distinct_titles },
  { metric: "redundant_titles", pipeline_1to1llm: pp.n - pp.distinct_titles, self_author: sa.n - sa.distinct_titles },
  { metric: "meta_correction_obs", pipeline_1to1llm: metaPP, self_author: metaSA },
], ["metric","pipeline_1to1llm","self_author"]));

// 3) Type distribution by regime
const kinds = await q(
  `select kind, count(*) filter (where generation_key is null) self_author,
          count(*) filter (where generation_key is not null) pipeline_1to1llm
   from observations where project_id=$1 and created_at>=$2 group by kind order by 3 desc`, [PROJ, SINCE]);
writeFileSync(`${OUT}/regime-type-distribution.csv`, csv(kinds, ["kind","self_author","pipeline_1to1llm"]));

// 4) Pipeline per-event redundancy
const dup = await q(
  `select metadata->>'title' title, count(*) occurrences
   from observations where project_id=$1 and created_at>=$2 and generation_key is not null
   group by 1 having count(*)>1 order by 2 desc limit 20`, [PROJ, SINCE]);
writeFileSync(`${OUT}/regime-pipeline-redundancy.csv`, csv(dup, ["title","occurrences"]));

const cum = (await q(`select count(*) n from observations where project_id=$1 and generation_key is null`, [PROJ]))[0].n;
const tot = (await q(`select count(*) n from observations where project_id=$1`, [PROJ]))[0].n;
console.log(`window since ${SINCE}: pipeline=${pp.n} self_author=${sa.n}`);
console.log(`all-time self_author=${cum}/${tot}; daily rows=${daily.length}`);
await c.end();
