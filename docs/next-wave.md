# Wave 2 closeout

## Wave 2 closeout (reconciled 2026-09-28)

The owner identified 099, 156, 179, 114, 126 and 132 as the remaining wave 2 closeout queue.
This record supersedes the original lane ordering for those plans. It is a scheduling
reconciliation, not proof that every other wave item is complete. Do not infer new production
permission from a documentation update; preserve explicit gates and owner-only checks.

Default sequence: **132 → 179 → 099 → 114 → 126 → 156**. Independent work can move earlier;
only the dependencies in this table require serialization.

| Plan | Remaining wave 2 delivery                                                                | Actual dependencies and follow-ups                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 132  | Typecheck ownership, HMR disposal/reload filtering, current Vite memory/cold-start proof | Schema collapse is deployed. Prebundling landed. Transfer old vibrancy workaround to 114; shared-dev terminal-id patch remains deferred.                                                            |
| 179  | P0 instruments, P3 Mermaid, P5 CSS, P6 isolation rule                                    | P1/P2/P4 landed. Instruments precede performance claims; 156 consumes isolation policy.                                                                                                             |
| 099  | Units 0–1: current consumer baseline and canonical publication                           | Include landed retained analysis from 198 in the inventory. Units 2–7 retain their explicit gate; no repeat SAB deletion.                                                                           |
| 114  | Gates 1–4: Chromium, native fallback, macOS, Electrobun removal                          | Preserve mesh ownership; Mac verification precedes removal. Consumes 132 ownership reconciliation, not an obsolete server lease.                                                                    |
| 126  | Remaining A–F/J proof and implementation residues                                        | A/D/F and parts of C/J delivered. Desktop cases use 114; independent chat/provider work can move earlier. G/H/I retain follow-up scope, with H pairing and I agent review already partly delivered. |
| 156  | P0 binary guard, P1 PDF, P2 CSV                                                          | Existing file identity/buffers and 179 policy suffice. P3–P6 are format/review/editing follow-ups; P7 DOCX source editing stays parked on Markdown and fidelity decisions.                          |

The owner superseded the former “198 first after wave 2” rule on 2026-09-28. Reconcile its
landed analysis code alongside 099. Schedule remaining 198 guarantees before the consumers that
need them, without making unrelated shell, Mermaid or PDF work wait. Plan 197's standalone/diff
highlighting is independent; Plan 200 needs the relevant 099/198 contracts and 197's diff service
for its comparison integration. The [root roadmap](../PLAN.md#wave-2-closeout-and-dependency-order)
records those boundaries.

Closeout checklist:

- [x] Refresh the six plan statuses and remove known completed implementation from their queues.
- [x] Replace historical ordering with current ownership/dependency boundaries.
- [ ] Execute remaining authorized units and record focused checks plus applicable live evidence.
- [ ] Reconcile owner-only checks and explicit follow-ups before declaring wave 2 complete.

Current `AGENTS.md` governs shared-checkout work, checks and deployment.

## Historical coordination

The [original lane assignments and coordination rules](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/docs/next-wave.md)
remain in git history. They describe the 2026-09-26 launch, including the original wave 3
split and owner-only checks. They are not a second current task queue.

[The completion-wave record](completion-wave.md) preserves earlier owner decisions and delivery
context. Each surviving plan owns its remaining authorization and acceptance requirements.
