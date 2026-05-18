#!/bin/bash
# Export benchmark data from claude_telemetry Postgres
# Usage: ./data/export-benchmarks.sh
# Requires: psql, ssh (for tunneling), credentials in ../.env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/../.env" ]; then
  source "$SCRIPT_DIR/../.env"
fi
: "${BM_PG_HOST:?Set BM_PG_HOST in .env}"
: "${BM_PG_USER:?Set BM_PG_USER in .env}"
: "${BM_PG_PASS:?Set BM_PG_PASS in .env}"

echo "Exporting benchmarks..."

# Create SSH tunnel for Postgres access
TUNNEL_PORT=5434
SSH_TUNNEL_PID=""

setup_tunnel() {
  echo "Setting up SSH tunnel to $BM_PG_HOST..."
  ssh -L "$TUNNEL_PORT:localhost:5432" "$BM_PG_HOST" -N &
  SSH_TUNNEL_PID=$!
  sleep 2
  echo "SSH tunnel established (PID: $SSH_TUNNEL_PID)"
}

cleanup_tunnel() {
  if [ -n "$SSH_TUNNEL_PID" ]; then
    kill "$SSH_TUNNEL_PID" 2>/dev/null || true
    echo "SSH tunnel closed"
  fi
}

trap cleanup_tunnel EXIT

setup_tunnel

# 1. Raw data (all runs, no secrets)
echo "date,hostname,cc_version,model,prompt,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,latency_ms" > "$SCRIPT_DIR/benchmarks-raw.csv"
PGPASSWORD="$BM_PG_PASS" psql -U "$BM_PG_USER" -h localhost -p "$TUNNEL_PORT" -d claude_telemetry -t -A -F',' -c "
SELECT
  DATE(created_at) as date,
  hostname,
  cc_version,
  llm_model as model,
  prompt_id as prompt,
  input_tokens,
  output_tokens,
  cache_creation_tokens,
  cache_read_tokens,
  latency_ms
FROM benchmarks
WHERE cc_version IS NOT NULL AND cc_version != ''
ORDER BY created_at;
" >> "$SCRIPT_DIR/benchmarks-raw.csv"

# 2. Aggregated by version + model
echo "cc_version,model,prompt,runs,median_latency_ms,min_latency_ms,max_latency_ms,avg_output_tokens,avg_cache_read_tokens" > "$SCRIPT_DIR/benchmarks-by-version.csv"
PGPASSWORD="$BM_PG_PASS" psql -U "$BM_PG_USER" -h localhost -p "$TUNNEL_PORT" -d claude_telemetry -t -A -F',' -c "
SELECT
  cc_version,
  llm_model as model,
  prompt_id as prompt,
  COUNT(*) as runs,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::int as median_latency_ms,
  MIN(latency_ms) as min_latency_ms,
  MAX(latency_ms) as max_latency_ms,
  ROUND(AVG(output_tokens)) as avg_output_tokens,
  ROUND(AVG(cache_read_tokens)) as avg_cache_read_tokens
FROM benchmarks
WHERE cc_version IS NOT NULL AND cc_version != ''
GROUP BY cc_version, llm_model, prompt_id
ORDER BY cc_version, llm_model, prompt_id;
" >> "$SCRIPT_DIR/benchmarks-by-version.csv"

echo "Done: benchmarks-raw.csv, benchmarks-by-version.csv"
