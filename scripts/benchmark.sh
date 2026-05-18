#!/usr/bin/env bash
# Sanitized for publication — see .env.example for required variables
# Benchmark: roda prompt padrão e captura tokens via stream-json
# Uso: ./benchmark.sh [prompt_id]
# Cron sugerido: a cada 6h

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$PATH"

# Load from environment or .env file
: "${BM_PG_HOST:?Set BM_PG_HOST}"
: "${BM_PG_USER:?Set BM_PG_USER}"
: "${BM_PG_PASS:?Set BM_PG_PASS}"
PG_HOST="$BM_PG_HOST"
PG_USER="$BM_PG_USER"
PG_PASS="$BM_PG_PASS"
PG_DB="${BM_PG_DB:-claude_telemetry}"

JSON_ONLY=0
PROMPT_ID="${1:-infra-check}"
[ "$2" = "--json" ] && JSON_ONLY=1
HOSTNAME_VAL=$(hostname -s)

CC_BIN=$(which claude 2>/dev/null || which claude-patched 2>/dev/null)
CC_VERSION=$("$CC_BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

case "$PROMPT_ID" in
  infra-check)
    PROMPT="List 5 common Linux performance bottlenecks in one sentence each. Be concise."
    ;;
  code-gen)
    PROMPT="Write a bash function that checks if a port is in use and returns 0 if free, 1 if busy."
    ;;
  analysis)
    PROMPT="Explain in 3 bullet points why caching reduces API costs in LLM applications."
    ;;
  *)
    PROMPT="$PROMPT_ID"
    PROMPT_ID="custom"
    ;;
esac

T_START=$(date +%s%3N)

STREAM=$("$CC_BIN" --print --output-format stream-json \
  --verbose \
  --model ${BENCH_MODEL:-claude-haiku-4-5-20251001} \
  "$PROMPT" 2>/dev/null)

T_END=$(date +%s%3N)
LATENCY=$(( T_END - T_START ))

TOKENS=$(echo "$STREAM" | python3 -c "
import sys,json
inp=out=cc=cr=cost=0
for line in sys.stdin:
  line=line.strip()
  if not line: continue
  try:
    d=json.loads(line)
    if d.get('type') == 'result':
      u=d.get('usage',{})
      inp=u.get('input_tokens',0)
      out=u.get('output_tokens',0)
      cc=u.get('cache_creation_input_tokens',0)
      cr=u.get('cache_read_input_tokens',0)
      cost=d.get('total_cost_usd',0)
  except: pass
print(inp,out,cc,cr,cost)
" 2>/dev/null)

read -r INPUT OUTPUT CACHE_CREATE CACHE_READ COST <<< "$TOKENS"

BENCH_MODEL_VAL="${BENCH_MODEL:-claude-haiku-4-5-20251001}"
echo "[benchmark] $HOSTNAME_VAL cc=$CC_VERSION model=$BENCH_MODEL_VAL prompt=$PROMPT_ID in=$INPUT out=$OUTPUT cc_tok=$CACHE_CREATE cr_tok=$CACHE_READ latency=${LATENCY}ms cost=\$${COST}"

if [ "${OUTPUT:-0}" -eq 0 ] && [ "${INPUT:-0}" -eq 0 ]; then
  echo "[benchmark] SKIP: zero tokens — API failure or stream parse error"
  exit 0
fi

PAYLOAD="{\"hostname\":\"$HOSTNAME_VAL\",\"cc_version\":\"$CC_VERSION\",\"prompt_id\":\"$PROMPT_ID\",\"input_tokens\":${INPUT:-0},\"output_tokens\":${OUTPUT:-0},\"cache_creation_tokens\":${CACHE_CREATE:-0},\"cache_read_tokens\":${CACHE_READ:-0},\"latency_ms\":$LATENCY}"

if [ "$JSON_ONLY" = "1" ]; then
  echo "$PAYLOAD"
else
  PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" --no-password \
    -v hostname="$HOSTNAME_VAL" \
    -v cc_version="$CC_VERSION" \
    -v prompt_id="$PROMPT_ID" \
    -v input_tokens="${INPUT:-0}" \
    -v output_tokens="${OUTPUT:-0}" \
    -v cache_creation_tokens="${CACHE_CREATE:-0}" \
    -v cache_read_tokens="${CACHE_READ:-0}" \
    -v latency_ms="$LATENCY" \
    -v llm_model="$BENCH_MODEL_VAL" \
    -c "INSERT INTO benchmarks (hostname, cc_version, prompt_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, latency_ms, llm_model) VALUES (:'hostname', :'cc_version', :'prompt_id', :input_tokens, :output_tokens, :cache_creation_tokens, :cache_read_tokens, :latency_ms, :'llm_model')" >/dev/null 2>&1
fi

exit 0
