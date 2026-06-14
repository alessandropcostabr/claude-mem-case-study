#!/bin/bash
# Export aggregated observation data from claude_mem Postgres
# Usage: ./data/export-observations.sh
# Requires: psql, ssh (for tunneling), credentials in ../.env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/../.env" ]; then
  source "$SCRIPT_DIR/../.env"
fi
: "${CM_PG_HOST:?Set CM_PG_HOST in .env}"
: "${CM_PG_USER:?Set CM_PG_USER in .env}"
: "${CM_PG_PASS:?Set CM_PG_PASS in .env}"

echo "Exporting observations..."

# Create SSH tunnel for Postgres access
TUNNEL_PORT=5433
SSH_TUNNEL_PID=""

setup_tunnel() {
  echo "Setting up SSH tunnel to $CM_PG_HOST..."
  ssh -L "$TUNNEL_PORT:localhost:5432" "$CM_PG_HOST" -N &
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

# 1. Daily aggregation by kind
echo "date,kind,count,tokens_spent" > "$SCRIPT_DIR/observations-daily.csv"
PGPASSWORD="$CM_PG_PASS" psql -U "$CM_PG_USER" -h localhost -p "$TUNNEL_PORT" -d claude_mem -t -A -F',' -c "
SELECT
  DATE(created_at) as date,
  kind,
  COUNT(*) as count,
  COALESCE(SUM((metadata->>'discovery_tokens')::int), 0) as tokens_spent
FROM observations
GROUP BY DATE(created_at), kind
ORDER BY date, kind;
" >> "$SCRIPT_DIR/observations-daily.csv"

# 2. Monthly summary
echo "month,total_obs,active_days,distinct_models,total_tokens" > "$SCRIPT_DIR/observations-monthly.csv"
PGPASSWORD="$CM_PG_PASS" psql -U "$CM_PG_USER" -h localhost -p "$TUNNEL_PORT" -d claude_mem -t -A -F',' -c "
SELECT
  TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
  COUNT(*) as total_obs,
  COUNT(DISTINCT DATE(created_at)) as active_days,
  COUNT(DISTINCT metadata->>'generated_by_model') as distinct_models,
  COALESCE(SUM((metadata->>'discovery_tokens')::int), 0) as total_tokens
FROM observations
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month;
" >> "$SCRIPT_DIR/observations-monthly.csv"

# 3. By model
echo "model,count,avg_tokens,total_tokens" > "$SCRIPT_DIR/observations-by-model.csv"
PGPASSWORD="$CM_PG_PASS" psql -U "$CM_PG_USER" -h localhost -p "$TUNNEL_PORT" -d claude_mem -t -A -F',' -c "
SELECT
  COALESCE(metadata->>'generated_by_model', 'unknown') as model,
  COUNT(*) as count,
  ROUND(AVG(COALESCE((metadata->>'discovery_tokens')::int, 0))) as avg_tokens,
  SUM(COALESCE((metadata->>'discovery_tokens')::int, 0)) as total_tokens
FROM observations
GROUP BY metadata->>'generated_by_model'
ORDER BY count DESC;
" >> "$SCRIPT_DIR/observations-by-model.csv"

echo "Done: observations-daily.csv, observations-monthly.csv, observations-by-model.csv"
