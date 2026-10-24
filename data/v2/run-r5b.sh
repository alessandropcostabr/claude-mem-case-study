#!/bin/bash
cd ~/claude-mem-case-study/data/v2
export LABEL_PREFIX='r5:'
export SAMPLE_FILE='claude-mem-case-study/data/v2/judge-sample-r5-arc.json'
MODELS=(
  "openai/gpt-oss-120b"
  "meta/llama-3.3-70b-instruct"
  "qwen/qwen3.5-397b-a17b"
  "deepseek-ai/deepseek-v4-pro"
)
for m in "${MODELS[@]}"; do
  echo "===== MODEL $m @ $(date +%H:%M:%S) ====="
  MODEL="$m" ~/.bun/bin/bun judge-rank-r5.mjs
  echo
done
echo "ALL DONE @ $(date +%H:%M:%S)"
