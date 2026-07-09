#!/bin/bash
cd ~/claude-mem-case-study/data/v2
export LABEL_PREFIX='r5:'
export SAMPLE_FILE='claude-mem-case-study/data/v2/judge-sample-r5-arc.json'
MODELS=(
  "qwen/qwen3.5-397b-a17b"
  "google/gemma-4-31b-it"
  "nvidia/nemotron-3-super-120b-a12b"
  "meta/llama-4-maverick-17b-128e-instruct"
  "openai/gpt-oss-120b"
  "meta/llama-3.3-70b-instruct"
  "deepseek-ai/deepseek-v4-pro"
)
for m in "${MODELS[@]}"; do
  echo "===== MODEL $m @ $(date +%H:%M:%S) ====="
  MODEL="$m" ~/.bun/bin/bun judge-rank-r5.mjs
  echo
done
echo "ALL DONE @ $(date +%H:%M:%S)"
