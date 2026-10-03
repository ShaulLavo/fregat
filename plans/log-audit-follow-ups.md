# August log-audit follow-ups

Status: Approved for current reproduction and reconciliation, scheduled with the roadmap's
observability work. Reviewed 2026-10-03. The [original August audit](../docs/log-audit-prompts.md)
preserves all 14 reports and their evidence. Its old paths, counts and proposed fixes describe
that checkout. This review does not establish that any of those defects still exists.

Reproduce before implementing. Record a current commit, command and observed result for each
report; match an existing issue or owning plan before creating work. A candidate owner below
identifies where to reconcile a confirmed defect. It does not claim that owner fixed the report.
[147](147-log-hygiene-and-noise-gate.md)'s delivered log cleanup still has its own census receipt.

| Report | Original observation                        | Current disposition and candidate owner                                                                                                                                                   |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1     | Fold projection errors on reparsing         | Needs current reproduction in Editor's fold/projection owner; consult the [Editor inventory](editor-backlog.md).                                                                          |
| P2     | WASM OOM after many Editor instances        | Needs bounded current reproduction; compare [198](198-document-owned-editor-analysis.md)'s lifecycle/retention checks and worker-disposal delivery.                                       |
| P3     | Error levels on expected HTTP results       | Needs current log census; reconcile with [147](147-log-hygiene-and-noise-gate.md).                                                                                                        |
| P4     | Repeating omitted-tab warnings              | Needs current reproduction and census under [147](147-log-hygiene-and-noise-gate.md).                                                                                                     |
| P5     | Client errors lacked context                | Needs current structured-error/log evidence under [147](147-log-hygiene-and-noise-gate.md).                                                                                               |
| P6     | Cancellation logged as an error             | Needs current operation/cancellation reproduction under [147](147-log-hygiene-and-noise-gate.md).                                                                                         |
| P7     | Unequal path redaction across client/server | Needs current privacy/log review under [147](147-log-hygiene-and-noise-gate.md); never publish private values in evidence.                                                                |
| P8     | Repeating theme resolution                  | Needs current measurement in appearance ownership; preserve [320](320-compile-time-data.md)'s separate compile-time theme scope.                                                          |
| P9     | Excess wallpaper requests                   | Needs current request/ownership measurement; consult [184](184-dependency-diet.md) and appearance ownership before assigning a fix.                                                       |
| P10    | Wallpaper EINTR reads lacked recovery       | Needs current read-path reproduction; keep its original filesystem evidence.                                                                                                              |
| P11    | Diff row-count mismatch                     | Needs current reproduction against the delivered diff service; compare [197](197-editor-highlighting-service.md) and the distinct line-topology scope in [307](307-diff-row-topology.md). |
| P12    | Duplicate structural-syntax errors          | Needs current syntax-owner/log census; compare [198](198-document-owned-editor-analysis.md) and [147](147-log-hygiene-and-noise-gate.md).                                                 |
| P13    | Filesystem read of a settings identity      | Needs current address/document-identity reproduction; compare [200](200-document-backed-content-views.md).                                                                                |
| P14    | HMR artifacts in error logs                 | Needs current dev-runtime reproduction; compare delivered [132](132-process-and-dev-ownership.md) and [147](147-log-hygiene-and-noise-gate.md).                                           |

None of these historical reports starts an automatic implementation lane. Retain unconfirmed
items until reproduced or ruled out with evidence. Scheduling remains in [PLAN.md](../PLAN.md).
