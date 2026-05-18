#!/usr/bin/env python3
"""
Generate publication-quality figures for the case study.

Outputs (in figures/):
  - fig1-latency-by-version.png  Opus vs Haiku median latency with 95% CI
  - fig2-observations-timeline.png  Daily observation volume over 70 days
  - fig3-observation-types.png  Distribution by observation type
"""

from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[1]
FIG = REPO / "figures"
FIG.mkdir(exist_ok=True)

# Tasteful, restrained color palette (no garish defaults)
COL_OPUS = "#1f4e79"
COL_HAIKU = "#c45a00"
COL_GREY = "#7f7f7f"
plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.titlesize": 12,
    "axes.labelsize": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linestyle": "--",
    "figure.dpi": 130,
})


def bootstrap_median_ci(values, n_boot=10000, ci=0.95, seed=42):
    rng = np.random.default_rng(seed)
    values = np.asarray(values)
    if len(values) < 2:
        return (np.nan, np.nan)
    n = len(values)
    boot = np.array([np.median(rng.choice(values, size=n, replace=True))
                      for _ in range(n_boot)])
    alpha = (1 - ci) / 2
    return np.quantile(boot, alpha), np.quantile(boot, 1 - alpha)


# ----------------------------------------------------------------------
# Figure 1: Opus vs Haiku latency by CC version (infra-check prompt)
# ----------------------------------------------------------------------
def figure1():
    df = pd.read_csv(REPO / "data" / "benchmarks-raw.csv")
    df["latency_s"] = df["latency_ms"] / 1000.0
    df = df[(df["prompt"] == "infra-check") & df["model"].notna()].copy()

    # Versions with n>=3 for each model
    versions = ["2.1.114", "2.1.119", "2.1.123", "2.1.126",
                "2.1.138", "2.1.140", "2.1.141", "2.1.142"]

    def collect(model):
        rows = []
        for v in versions:
            lat = df[(df["cc_version"] == v) & (df["model"] == model)]["latency_s"].values
            if len(lat) >= 3:
                med = np.median(lat)
                lo, hi = bootstrap_median_ci(lat)
                rows.append((v, len(lat), med, lo, hi))
        return rows

    opus = collect("claude-opus-4-6")
    haiku = collect("claude-haiku-4-5-20251001")

    fig, ax = plt.subplots(figsize=(9, 5))

    for series, color, label in [(opus, COL_OPUS, "Opus 4.6"),
                                   (haiku, COL_HAIKU, "Haiku 4.5")]:
        x = [r[0] for r in series]
        med = np.array([r[2] for r in series])
        lo = np.array([r[3] for r in series])
        hi = np.array([r[4] for r in series])
        yerr = np.vstack([med - lo, hi - med])
        ax.errorbar(x, med, yerr=yerr, fmt="o-", color=color,
                    capsize=4, capthick=1.5, lw=2, ms=7,
                    label=label, alpha=0.95)

    # Annotate baseline + regression
    ax.axhline(34.69, color=COL_OPUS, lw=0.8, ls=":", alpha=0.5)
    ax.axhline(38.25, color=COL_HAIKU, lw=0.8, ls=":", alpha=0.5)

    ax.set_xlabel("Claude Code version")
    ax.set_ylabel("Median latency (s, infra-check)")
    ax.set_title("Per-version latency: Opus vs Haiku diverge after Anthropic's harness fix\n"
                  "(error bars = 95 % bootstrap CI on the median, n ≥ 3 per point)")
    ax.legend(loc="upper right", frameon=False)
    ax.set_ylim(0, max([r[4] for r in opus + haiku]) * 1.1)
    plt.xticks(rotation=20)
    plt.tight_layout()
    out = FIG / "fig1-latency-by-version.png"
    plt.savefig(out, dpi=160, bbox_inches="tight")
    plt.close()
    print(f"Wrote {out.relative_to(REPO)}")


# ----------------------------------------------------------------------
# Figure 2: Observation volume timeline
# ----------------------------------------------------------------------
def figure2():
    df = pd.read_csv(REPO / "data" / "observations-daily.csv")
    df["date"] = pd.to_datetime(df["date"])
    daily = df.groupby("date", as_index=False)["count"].sum()
    daily.columns = ["date", "observations"]
    daily = daily.sort_values("date").reset_index(drop=True)

    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.bar(daily["date"], daily["observations"], color=COL_OPUS, alpha=0.85, width=0.85)

    # 7-day rolling mean overlay
    daily = daily.sort_values("date")
    rolling = daily["observations"].rolling(window=7, min_periods=1).mean()
    ax.plot(daily["date"], rolling, color=COL_HAIKU, lw=2, alpha=0.95,
             label="7-day rolling mean")

    ax.set_xlabel("Date")
    ax.set_ylabel("Observations per day")
    ax.set_title("Daily observation volume over 70 days (n = 22,718 total)")
    ax.legend(loc="upper left", frameon=False)
    plt.xticks(rotation=20)
    plt.tight_layout()
    out = FIG / "fig2-observations-timeline.png"
    plt.savefig(out, dpi=160, bbox_inches="tight")
    plt.close()
    print(f"Wrote {out.relative_to(REPO)}")


# ----------------------------------------------------------------------
# Figure 3: Observation types
# ----------------------------------------------------------------------
def figure3():
    # Use the data from the README table; if a CSV exists for it, use that
    # The structure is well known
    types_data = [
        ("discovery", 11147, 5835),
        ("pattern", 4543, 0),
        ("change", 3103, 6837),
        ("feature", 1653, 11066),
        ("bugfix", 1262, 9402),
        ("decision", 757, 9885),
        ("refactor", 246, 11115),
    ]
    types_data.sort(key=lambda x: x[1], reverse=True)
    labels = [t[0] for t in types_data]
    counts = np.array([t[1] for t in types_data])
    total = counts.sum()
    pct = counts / total * 100

    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.barh(labels, counts, color=COL_OPUS, alpha=0.88)
    for i, (b, c, p) in enumerate(zip(bars, counts, pct)):
        ax.text(b.get_width() + total * 0.005,
                b.get_y() + b.get_height() / 2,
                f"{c:,} ({p:.1f}%)",
                va="center", fontsize=9, color="#333")
    ax.set_xlabel("Number of observations")
    ax.set_title("Distribution of observations by type (n = 22,711)")
    ax.invert_yaxis()
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))
    ax.set_xlim(0, counts.max() * 1.18)
    plt.tight_layout()
    out = FIG / "fig3-observation-types.png"
    plt.savefig(out, dpi=160, bbox_inches="tight")
    plt.close()
    print(f"Wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    figure1()
    figure2()
    figure3()
    print("All figures generated.")
