import Foundation

/// Where a web number comes from. The tier matters more than the number: a
/// figure nobody can re-run is a memory, not a baseline, and "meets or beats"
/// against a memory is unfalsifiable.
enum Provenance: Int, CaseIterable {
  /// Checked into `editor/` with the command that reproduces it.
  case checkedIn = 1
  /// A live gate threshold in this repo's Playwright harness.
  case liveGate = 2
  /// Recorded in a session, dated, methodology known, no checked-in command.
  case sessionRecord = 3

  var marker: String { "[\(rawValue)]" }

  var legend: String {
    switch self {
    case .checkedIn:
      return
        "[1] checked in — editor/docs/architecture/phase-0/performance-baseline.md (2026-05-24, Bun 1.3.10) plus the bench/*.ts it names. Re-runnable by command."
    case .liveGate:
      return
        "[2] live gate — threshold constants in apps/web/scripts/editor-{typing,scroll}-benchmark.mjs. The threshold is real; the harness cannot run today (seeding drift, see doc §5)."
    case .sessionRecord:
      return
        "[3] session record — measured and dated, but no checked-in command reproduces it. Treat as provisional until re-measured; see doc §3."
    }
  }
}

/// One line of the gate. `gateMs` is the number the native editor has to meet
/// or beat; `nativeMs` stays nil until the plan that implements the path
/// registers a result.
struct BaselineRow {
  let id: String
  let corpus: String
  let statistic: String
  let webReference: String
  var webThisMachine: String = "—"
  let gateMs: Double?
  let provenance: Provenance
  var nativeMs: Double?

  var nativeCell: String { nativeMs.map { formatMs($0) } ?? "—" }

  var verdict: String {
    guard let native = nativeMs else { return "—" }
    guard let gate = gateMs else { return "no gate" }

    return native <= gate ? "pass" : "FAIL"
  }
}

/// Interaction rows: what the user actually feels. Every one of these is a
/// keystroke-to-frame or frame-cadence number, and none of them can be
/// re-measured on this machine today — the web harness that produced them no
/// longer seeds a workspace (doc §5).
func interactionBaselines() -> [BaselineRow] {
  [
    BaselineRow(
      id: "typing.steady.p50",
      corpus: "1M-line TS, chromium, 40ms key delay",
      statistic: "p50",
      webReference: "4.4–5.7 ms",
      webThisMachine: "not run",
      gateMs: 4.4,
      provenance: .sessionRecord
    ),
    BaselineRow(
      id: "typing.steady.p95",
      corpus: "1M-line TS, chromium, 40ms key delay",
      statistic: "p95",
      webReference: "6–9 ms",
      webThisMachine: "not run",
      gateMs: 6,
      provenance: .sessionRecord
    ),
    BaselineRow(
      id: "typing.burst.p95",
      corpus: "40 keys, no inter-key delay",
      statistic: "p95",
      webReference: "≤ 12 ms",
      webThisMachine: "not run",
      gateMs: 12,
      provenance: .liveGate
    ),
    BaselineRow(
      id: "typing.applyEdit.mean",
      corpus: "editor.view.applyEdit diagnostic",
      statistic: "mean",
      webReference: "≤ 3 ms",
      webThisMachine: "not run",
      gateMs: 3,
      provenance: .liveGate
    ),
    BaselineRow(
      id: "scroll.frame.mean",
      corpus: "80 steps x 36px, uncapped frames",
      statistic: "median of trials",
      webReference: "≤ 10 ms",
      webThisMachine: "not run",
      gateMs: 10,
      provenance: .liveGate
    ),
    BaselineRow(
      id: "scroll.frame.max",
      corpus: "wheel scroll, TSX / PNG-as-text",
      statistic: "max",
      webReference: "17.9 / 18.8 ms",
      webThisMachine: "not run",
      gateMs: 17.9,
      provenance: .sessionRecord
    ),
    BaselineRow(
      id: "highlight.viewport.p50",
      corpus: "tree-sitter viewport query, ~960 tokens",
      statistic: "p50",
      webReference: "0.2 ms",
      webThisMachine: "not run",
      gateMs: 0.2,
      provenance: .sessionRecord
    ),
    BaselineRow(
      id: "highlight.viewport.p95",
      corpus: "tree-sitter viewport query, 50K-line doc",
      statistic: "p95",
      webReference: "6 ms",
      webThisMachine: "not run",
      gateMs: 6,
      provenance: .sessionRecord
    ),
  ]
}

/// Document rows: the storage and projection paths the native port reimplements
/// one for one. These re-run by command, so they carry a same-machine column
/// captured the day this harness was written.
func documentBaselines() -> [BaselineRow] {
  [
    BaselineRow(
      id: "piecetable.insert.append",
      corpus: "2,000 x 1 KiB appends",
      statistic: "mean/insertion",
      webReference: "0.0048 ms",
      webThisMachine: "0.0098 ms",
      gateMs: 0.0098,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "piecetable.insert.growth",
      corpus: "last 3 batches / first 3 batches",
      statistic: "ratio",
      webReference: "0.64x",
      webThisMachine: "0.42x",
      gateMs: nil,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "piecetable.walk.sequential",
      corpus: "30.7K chars, 3,856 pieces",
      statistic: "mean",
      webReference: "—",
      webThisMachine: "0.2587 ms",
      gateMs: 0.2587,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "piecetable.seek.random",
      corpus: "5,000 seeks + 64-char reads",
      statistic: "mean",
      webReference: "—",
      webThisMachine: "3.2545 ms",
      gateMs: 3.2545,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "piecetable.snapshot.build",
      corpus: "100K lines, incremental index",
      statistic: "mean",
      webReference: "—",
      webThisMachine: "72.0484 ms",
      gateMs: 72.0484,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "piecetable.anchor.resolve",
      corpus: "100K lines, 1,089 anchors, indexed",
      statistic: "mean",
      webReference: "—",
      webThisMachine: "0.0003 ms",
      gateMs: 0.0003,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "foldmap.create",
      corpus: "100K lines, 100 folds",
      statistic: "mean",
      webReference: "6.8320 ms",
      webThisMachine: "6.6460 ms",
      gateMs: 6.646,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "foldmap.roundtrip.p95",
      corpus: "100 points, 1,000 iterations",
      statistic: "p95",
      webReference: "0.1229 ms",
      webThisMachine: "0.0556 ms",
      gateMs: 0.0556,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "virtualization.mount.large",
      corpus: "100K lines, 44 mounted rows",
      statistic: "mean",
      webReference: "45.2990 ms",
      webThisMachine: "57.1580 ms",
      gateMs: 45.299,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "virtualization.mount.longline",
      corpus: "50K-char line, 2,048 mounted chars",
      statistic: "mean",
      webReference: "2.9140 ms",
      webThisMachine: "2.6820 ms",
      gateMs: 2.682,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "syntax.edit.total.10k",
      corpus: "TypeScript, 10K lines, parse + query",
      statistic: "total",
      webReference: "145.3300 ms",
      webThisMachine: "115.6800 ms",
      gateMs: 115.68,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "syntax.edit.parse.100k",
      corpus: "TypeScript, 100K lines, incremental parse",
      statistic: "total",
      webReference: "—",
      webThisMachine: "8.7200 ms",
      gateMs: 8.72,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "syntax.edit.total.100k",
      corpus: "TypeScript, 100K lines, parse + query",
      statistic: "total",
      webReference: "1732.8900 ms",
      webThisMachine: "1183.6000 ms",
      gateMs: 1183.6,
      provenance: .checkedIn
    ),
    BaselineRow(
      id: "minimap.update.mean",
      corpus: "100K lines, 50 edits",
      statistic: "mean",
      webReference: "0.7487 ms",
      webThisMachine: "bench broken",
      gateMs: 0.7487,
      provenance: .checkedIn
    ),
  ]
}
