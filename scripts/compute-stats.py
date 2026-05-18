#!/usr/bin/env python3
"""
Compute statistical summary of benchmark data.

Outputs:
  - 95% bootstrap CI on median latency per (version, model, prompt)
  - Mann-Whitney U test for Opus vs Haiku at v2.1.142 (divergence claim)
  - Wilcoxon test: regression at 2.1.119 vs baseline 2.1.114
  - Recovery test: Opus 2.1.123 vs 2.1.114 (recovery below baseline)
  - Distribution shape: IQR, skewness per group

Writes:
  - data/benchmarks-stats.csv (machine-readable summary)
  - prints human-readable report to stdout
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "data" / "benchmarks-raw.csv"
OUT = REPO / "data" / "benchmarks-stats.csv"


def bootstrap_median_ci(values, n_boot=10000, ci=0.95, seed=42):
    """Bootstrap 95% CI for the median of a sample."""
    rng = np.random.default_rng(seed)
    values = np.asarray(values)
    if len(values) < 2:
        return (np.nan, np.nan)
    boot_medians = np.empty(n_boot)
    n = len(values)
    for i in range(n_boot):
        sample = rng.choice(values, size=n, replace=True)
        boot_medians[i] = np.median(sample)
    alpha = (1 - ci) / 2
    return (np.quantile(boot_medians, alpha), np.quantile(boot_medians, 1 - alpha))


def main():
    df = pd.read_csv(RAW)
    # Latency in seconds for readability
    df["latency_s"] = df["latency_ms"] / 1000.0
    df = df[df["latency_s"] > 0].copy()
    df = df[df["model"].notna() & (df["model"] != "")].copy()

    summary_rows = []
    for (version, model, prompt), grp in df.groupby(["cc_version", "model", "prompt"]):
        lat = grp["latency_s"].values
        if len(lat) < 2:
            continue
        med = np.median(lat)
        lo, hi = bootstrap_median_ci(lat)
        iqr = np.percentile(lat, 75) - np.percentile(lat, 25)
        sk = stats.skew(lat) if len(lat) > 2 else np.nan
        summary_rows.append({
            "cc_version": version,
            "model": model,
            "prompt": prompt,
            "n": len(lat),
            "median_s": round(med, 2),
            "ci95_lo_s": round(lo, 2),
            "ci95_hi_s": round(hi, 2),
            "iqr_s": round(iqr, 2),
            "skewness": round(sk, 2) if not np.isnan(sk) else None,
            "min_s": round(np.min(lat), 2),
            "max_s": round(np.max(lat), 2),
        })

    out_df = pd.DataFrame(summary_rows).sort_values(["model", "prompt", "cc_version"])
    out_df.to_csv(OUT, index=False)
    print(f"Wrote {OUT.relative_to(REPO)} ({len(out_df)} rows)\n")

    print("=" * 80)
    print("HUMAN-READABLE STATISTICAL REPORT")
    print("=" * 80)

    # Pick the key cells used in the README narrative
    print("\n## Bootstrap 95% CI on median latency (key versions)\n")
    print(f"{'Version':<10} {'Model':<25} {'Prompt':<12} {'n':>3} "
          f"{'Median (s)':>12} {'95% CI':>20}")
    print("-" * 95)
    for _, r in out_df.iterrows():
        if r["cc_version"] in ("2.1.114", "2.1.119", "2.1.123", "2.1.126",
                                 "2.1.138", "2.1.142"):
            ci = f"[{r['ci95_lo_s']:.1f}, {r['ci95_hi_s']:.1f}]"
            print(f"{r['cc_version']:<10} {r['model']:<25} {r['prompt']:<12} "
                  f"{int(r['n']):>3} {r['median_s']:>12.2f} {ci:>20}")

    # Hypothesis tests
    print("\n\n## Hypothesis tests\n")

    def sample(version, model, prompt="infra-check"):
        sub = df[(df["cc_version"] == version) &
                 (df["model"] == model) &
                 (df["prompt"] == prompt)]
        return sub["latency_s"].values

    # H1: regression at 2.1.119 vs baseline 2.1.114 (Opus)
    a = sample("2.1.114", "claude-opus-4-6")
    b = sample("2.1.119", "claude-opus-4-6")
    if len(a) > 0 and len(b) > 0:
        u, p = stats.mannwhitneyu(a, b, alternative="less")
        print(f"H1 (Opus regression at 2.1.119 > 2.1.114):")
        print(f"   n1={len(a)}, n2={len(b)},  "
              f"Mann-Whitney U={u:.1f},  p={p:.4g}")

    # H2: recovery: Opus 2.1.123 < 2.1.114 (faster than baseline)
    a = sample("2.1.114", "claude-opus-4-6")
    b = sample("2.1.123", "claude-opus-4-6")
    if len(a) > 0 and len(b) > 0:
        u, p = stats.mannwhitneyu(a, b, alternative="greater")
        print(f"\nH2 (Opus recovery at 2.1.123 < 2.1.114):")
        print(f"   n1={len(a)}, n2={len(b)},  "
              f"Mann-Whitney U={u:.1f},  p={p:.4g}")

    # H3: divergence at 2.1.142: Opus < Haiku
    a = sample("2.1.142", "claude-opus-4-6")
    b = sample("2.1.142", "claude-haiku-4-5-20251001")
    if len(a) > 0 and len(b) > 0:
        u, p = stats.mannwhitneyu(a, b, alternative="less")
        print(f"\nH3 (At 2.1.142, Opus < Haiku — model divergence):")
        print(f"   n_opus={len(a)} median={np.median(a):.1f}s, "
              f"n_haiku={len(b)} median={np.median(b):.1f}s")
        print(f"   Mann-Whitney U={u:.1f},  p={p:.4g}")

    # H4: Haiku 2.1.142 still elevated vs Haiku 2.1.114
    a = sample("2.1.114", "claude-haiku-4-5-20251001")
    b = sample("2.1.142", "claude-haiku-4-5-20251001")
    if len(a) > 0 and len(b) > 0:
        u, p = stats.mannwhitneyu(a, b, alternative="less")
        print(f"\nH4 (Haiku still elevated at 2.1.142 vs baseline 2.1.114):")
        print(f"   n1={len(a)} median={np.median(a):.1f}s, "
              f"n2={len(b)} median={np.median(b):.1f}s")
        print(f"   Mann-Whitney U={u:.1f},  p={p:.4g}")

    # H5: Real recovery — Opus 2.1.126 vs baseline 2.1.114 (recovery at .126, not .123)
    a = sample("2.1.114", "claude-opus-4-6")
    b = sample("2.1.126", "claude-opus-4-6")
    if len(a) > 0 and len(b) > 0:
        u, p = stats.mannwhitneyu(a, b, alternative="greater")
        print(f"\nH5 (Opus recovery at 2.1.126 ≤ 2.1.114 — true recovery point):")
        print(f"   n1={len(a)} median={np.median(a):.1f}s, "
              f"n2={len(b)} median={np.median(b):.1f}s")
        print(f"   Mann-Whitney U={u:.1f},  p={p:.4g}")

    # H6: Opus 2.1.142 strictly faster than 2.1.114 (the -44% headline claim)
    a = sample("2.1.114", "claude-opus-4-6")
    b = sample("2.1.142", "claude-opus-4-6")
    if len(a) > 0 and len(b) > 0:
        u, p = stats.mannwhitneyu(a, b, alternative="greater")
        print(f"\nH6 (Opus -44% headline: 2.1.142 < 2.1.114):")
        print(f"   n1={len(a)} median={np.median(a):.1f}s, "
              f"n2={len(b)} median={np.median(b):.1f}s, "
              f"reduction={(1 - np.median(b)/np.median(a))*100:.1f}%")
        print(f"   Mann-Whitney U={u:.1f},  p={p:.4g}")

    # H7: Haiku regression at 2.1.119 vs baseline
    a = sample("2.1.114", "claude-haiku-4-5-20251001")
    b = sample("2.1.119", "claude-haiku-4-5-20251001")
    if len(a) > 0 and len(b) > 0:
        u, p = stats.mannwhitneyu(a, b, alternative="less")
        print(f"\nH7 (Haiku regression at 2.1.119 > 2.1.114):")
        print(f"   n1={len(a)} median={np.median(a):.1f}s, "
              f"n2={len(b)} median={np.median(b):.1f}s")
        print(f"   Mann-Whitney U={u:.1f},  p={p:.4g}")


if __name__ == "__main__":
    main()
