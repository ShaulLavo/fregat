"""Plot a tree-height replay: python3 bench/plot-height.py path/to/height.json."""

import argparse
import csv
import html
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import median

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


LABELS = {
    ("singapore", "sequence"): "Singapore sequence",
    ("vscode", "sequence"): "VS Code red-black",
}


def grouped_points(rows, metric):
    groups = defaultdict(list)
    for row in rows:
        value = row[metric]
        if value is not None:
            groups[row["operation"]].append(value)
    xs = sorted(groups)
    centers = [median(groups[x]) for x in xs]
    lower = [center - min(groups[x]) for x, center in zip(xs, centers)]
    upper = [max(groups[x]) - center for x, center in zip(xs, centers)]
    return xs, centers, [lower, upper]


def finish(fig, ax, target, title, xlabel, ylabel):
    ax.set_title(title, loc="left", pad=16)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_ylim(bottom=0)
    ax.grid(True, alpha=0.2)
    ax.legend(fontsize=9)
    fig.tight_layout()
    fig.savefig(target, bbox_inches="tight")
    plt.close(fig)


def plot_report(source, allow_partial=False):
    source = Path(source)
    data = json.loads(source.read_text())
    if data.get("schemaVersion") != 1 or data.get("kind") != "tree-height":
        raise ValueError("Expected a version-1 tree-height report")
    if not data.get("complete") and not allow_partial:
        raise ValueError("Incomplete replay; pass --allow-partial to label and plot partial data")
    if not data["rows"]:
        raise ValueError("Report has no samples")
    directory = source.parent
    figures = directory / "figures"
    figures.mkdir(exist_ok=True)
    fields = [name for name in data["rows"][0] if name != "depthCounts"]
    with (directory / "height.csv").open("w", newline="") as output:
        writer = csv.DictWriter(output, fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(data["rows"])
    scenarios = defaultdict(list)
    for row in data["rows"]:
        scenarios[(row["workload"], row["traceSeed"])].append(row)
    status = "Complete" if data.get("complete") else "PARTIAL"
    if data["failures"]:
        status += f"; {len(data['failures'])} failed runs"
    intro = (
        f"{status}. Heights count levels: root = 1, empty = 0. "
        "Lines show medians across runs; whiskers show the sampled min/max. "
        "Each trace seed has its own charts. VS Code runs once per trace. "
        "The piece-count scatter uses every sampled seed. Tree shape is measured in a separate replay."
    )
    sections = []
    summary = ["# Tree height", "", intro, "", "| Workload | Trace seed | Tree | Max sampled levels | Pieces at that sample | Max height/log2(P+1) |", "| --- | ---: | --- | ---: | ---: | ---: |"]
    for (workload, trace_seed), rows in sorted(scenarios.items()):
        safe = "".join(c if c.isalnum() or c == "-" else "-" for c in workload)
        prefix = f"{safe}-{trace_seed}"
        title = f"{workload} · trace {trace_seed}"
        groups = defaultdict(list)
        for row in rows:
            groups[(row["engine"], row["tree"])].append(row)
        names = []
        for metric, suffix, ylabel in [
            ("height", "height", "Height (levels)"),
            ("heightOverLog2", "normalized", "Height / log2(stored pieces + 1)"),
            ("meanDepth", "mean-depth", "Mean stored-piece depth (root = 0)"),
        ]:
            fig, ax = plt.subplots(figsize=(9, 5))
            for key, samples in sorted(groups.items()):
                xs, centers, spread = grouped_points(samples, metric)
                if xs:
                    ax.errorbar(xs, centers, yerr=spread, label=LABELS[key],
                                capsize=2, errorevery=max(1, len(xs) // 16))
            if metric == "heightOverLog2":
                ax.axhline(1, linestyle="--", linewidth=1, label="Counting lower bound")
            name = f"{prefix}-{suffix}.svg"
            names.append(name)
            finish(fig, ax, figures / name, title, "Logical edit operations", ylabel)
        fig, ax = plt.subplots(figsize=(9, 5))
        nonempty = [row for row in rows if row["pieces"] > 0]
        for key, samples in sorted(groups.items()):
            kept = [row for row in samples if row["pieces"] > 0]
            if kept:
                ax.scatter([r["pieces"] for r in kept], [r["height"] for r in kept],
                           label=LABELS[key], s=14, alpha=0.55)
        if nonempty:
            maximum = max(row["pieces"] for row in nonempty)
            xs = sorted(set([1, maximum] + [2 ** i - 1 for i in range(1, maximum.bit_length() + 1)]))
            ax.plot(xs, [math.ceil(math.log2(x + 1)) for x in xs],
                    linestyle="--", label="Minimum possible height")
            ax.set_xscale("log", base=2)
        name = f"{prefix}-pieces-height.svg"
        names.append(name)
        finish(fig, ax, figures / name, title, "Stored pieces (log2 scale)", "Height (levels)")
        fig, ax = plt.subplots(figsize=(9, 5))
        for key, samples in sorted(groups.items()):
            if key[1] != "sequence":
                continue
            for metric in (["pieces", "tombstones"] if key[0] == "singapore" else ["pieces"]):
                xs, centers, spread = grouped_points(samples, metric)
                ax.errorbar(xs, centers, yerr=spread, label=f"{key[0]} {metric}",
                            capsize=2, errorevery=max(1, len(xs) // 16))
        name = f"{prefix}-piece-count.svg"
        names.append(name)
        finish(fig, ax, figures / name, title, "Logical edit operations", "Stored pieces / tombstones")
        for key, samples in sorted(groups.items()):
            highest = max(samples, key=lambda row: row["height"])
            ratios = [row["heightOverLog2"] for row in samples if row["heightOverLog2"] is not None]
            ratio = f"{max(ratios):.3f}" if ratios else "empty"
            summary.append(f"| {workload} | {trace_seed} | {LABELS[key]} | {highest['height']} | {highest['pieces']} | {ratio} |")
        pictures = "\n".join(f'<img loading="lazy" src="figures/{name}" alt="{html.escape(name)}">' for name in names)
        sections.append(f"<section><h2>{html.escape(title)}</h2>{pictures}</section>")
    summary.extend(["", "P includes tombstones. Height ratios use each tree's own P.",
                    "Seed ranges describe these runs. Unsampled edits may have taller trees.",
                    "Average depths describe stored pieces; operation paths can involve several searches.",
                    "", f"Source commit: `{data.get('sourceCommit')}`. Runtime: `{data['runtime']['node']}`.",
                    f"Failures: {len(data['failures'])}. Raw samples: `height.json`; flattened samples: `height.csv`."])
    (directory / "summary.md").write_text("\n".join(summary) + "\n")
    page = """<!doctype html><html lang="en"><meta charset="utf-8">
<title>Textbuffer tree height</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:1050px;margin:3rem auto;padding:0 1rem;line-height:1.6}img{max-width:100%;height:auto;margin:1rem 0}section{margin:3rem 0}h1,h2{line-height:1.2}</style>
""" + f"<h1>Textbuffer tree height</h1><p>{html.escape(intro)}</p>" + "\n".join(sections)
    (directory / "index.html").write_text(page + "</html>\n")
    print(f"Wrote {len(scenarios) * 5} plots, height.csv, summary.md, and index.html in {directory}")
    return directory


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()
    plot_report(args.report, args.allow_partial)
