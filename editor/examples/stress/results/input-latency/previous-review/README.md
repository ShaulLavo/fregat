# Previous review measurements

These files preserve the failed review candidate and its original calibration before the mounted
geometry/chunk optimization and fresh calibration. The saved [report](verification.json) used
144 blocking timing groups: six failed, including four screenshot-completion upper bounds.

| Fixture             | Views    | Input              | Metric                 | Candidate p95 (ms) | Limit (ms) |
| ------------------- | -------- | ------------------ | ---------------------- | -----------------: | ---------: |
| Ordinary            | Single   | Undo               | Screenshot upper bound |              154.2 |      125.8 |
| Ordinary            | Multiple | Typing             | Input to applied       |                2.2 |        2.1 |
| Ordinary            | Multiple | Typing             | Dispatch               |                2.2 |        2.1 |
| Ordinary            | Multiple | Typing             | Screenshot upper bound |              153.3 |      137.5 |
| 500,000 short lines | Multiple | Repeat             | Screenshot upper bound |              305.6 |      174.0 |
| One-megabyte line   | Single   | Composition update | Screenshot upper bound |              115.0 |      100.4 |

The intermediate policy made screenshot timing advisory while keeping the original numerical
formula; the two typing failures remained. The current policy also uses the controls' full observed
timing range. The archived report is unchanged and records the policy in effect when it was written.

The [paired typing investigation](../paired-typing-investigation.json) alternated the old and
review-corrected builds across 144 events each: dispatch p95 was 2.1 ms and 2.0 ms, with 1.1 ms
medians. The [paste investigation](../paired-paste-investigation.json) observed 9.9 ms and 9.6 ms
p95 across 48 events each. These checks found no slowdown in their workloads; neither replaces
the failed full-suite comparison. The paste probe supplied missing verification attributes after
timing and is excluded from acceptance evidence.

The earlier first failed attempt remains in [the parent result directory](../README.md) as
`failed-first-candidate.json.gz` and `failed-first-comparison.json.gz`.
