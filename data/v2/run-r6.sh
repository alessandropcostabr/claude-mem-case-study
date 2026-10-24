#!/bin/bash
# Round 6 — bar-raise validation: C-Stop vs arc-old vs arc-new.
# Runs from .100 (OR key lives there). Writes to eval_rank on PG .253.
cd ~
MODELS=(
  "google/gemma-4-31b-it:gemma-4-31b"
  "nvidia/nemotron-3-super-120b-a12b:nemotron-3-120b"
  "openai/gpt-oss-120b:gpt-oss-120b"
  "qwen/qwen3.5-397b-a17b:qwen3.5-397b"
  "deepseek-ai/deepseek-v4-pro:deepseek-v4"
)
for entry in "${MODELS[@]}"; do
  m="${entry%%:*}"; label="${entry##*:}"
  echo "===== $label @ $(date +%H:%M:%S) ====="
  OR_MODEL="$m" OR_LABEL="$label" ~/.bun/bin/bun ~/claude-mem-case-study/data/v2/judge-rank-r6.mjs
  echo
done
echo "R6 ALL DONE @ $(date +%H:%M:%S)"
