# Editor backlog plan contract

These plans began with proposals commissioned on 2026-09-05. A plan the owner asks for is approved
work: its status is `Approved` and it is written for execution. `Idea` is only for a plan the
owner explicitly calls an idea or is unsure about. Platform's [cross-project roadmap](../../platform/PLAN.md)
remains the execution scheduler. The Editor backlog index recommends an order without scheduling work.

## Write a plan another engineer can execute

Read Editor's `AGENTS.md`, the relevant `TODO.md` section, and the actual source before writing.
The initial inspection baseline is Editor `9abb944f3a2b8d6516953fdec75e8df5e1a94811`.
Later plans record their actual inspected commit in a per-entry `baseline` in `backlog.json`;
otherwise the manifest's original baseline applies. Match the plan's inspected-baseline metadata.
Record what already exists. Treat the old wishlist's missing-feature and performance claims as
hypotheses until checked. Label proposed types and file paths as proposed, and link existing files.

Use this structure for each `eNNN-*.md` document:

1. Title with its stable E-number and the user-visible or engineering outcome.
2. Metadata: status, kind, owner, priority, effort, dependencies, and inspected baseline.
3. `## Outcome`: the problem, desired behavior, and a concrete example.
4. `## Current code`: verified entry points, existing functionality, and drift to check again.
5. `## Scope`: deliverables and explicit limits, including who owns any host integration.
6. `## Design`: core data, ownership, lifecycle, and the decision that needs evidence.
7. `## Steps`: bounded implementation or research stages, each ending with evidence.
8. `## Verification`: meaningful scenarios, existing test or benchmark entry points, and an
   acceptance gate. Name the specific failure each new test should catch.
9. `## Risks and decisions`: unresolved choices, failure modes, and stop conditions.

Scale detail to the work, normally 70–140 lines. Avoid boilerplate that obscures the actual task.
Research plans end in a measured decision and follow-up scope; they do not promise an architecture
will be faster. Use existing algorithms and representations as controls. Do not invent measured
numbers, ready-made public APIs, or executed tests. Every performance plan measures a baseline and
compares the final artifact under the same conditions.

## Keep the boundaries accurate

Editor owns reusable document, input, view, syntax, and extension APIs. Platform owns filesystem
access, workspace/project policy, persistence destinations, settings registration, and app chrome.
A host-facing feature can include an Editor demo, but that does not implement Platform integration.
Mark a plan `Cross-repo` or `Platform` if completing its stated outcome needs that work.

Reuse the shipped shared keymap runtime and prepared-document/visible-paint contracts. Do not plan
another chord matcher or active-editor singleton. Do not restore compatibility APIs deleted by
the architecture work. Document illegal states, cancellation, disposal, undo/selection correctness,
and multi-view behavior where relevant.

Read package scripts before naming commands. Editor tests run through Vitest/package scripts,
never `bun test`. Layout, focus, paint, clipboard, and trusted keyboard behavior need a real
browser. Reuse existing dev servers. Public API changes need built-export checks and framework
consumer checks. Platform work must follow its own repository instructions and settings registry.

## Maintain the inventory

`backlog.json` records every plan, its dependencies, and its original wishlist coverage. Keep it
consistent with plan metadata. The root author owns `README.md`, `backlog.json`, this contract,
and the verifier. Plan authors edit only their assigned plan files and report any dependency
changes to the root author. Run the backlog verifier after changes to the inventory or plans.

Schema version 2 keeps executable entries under `file`. Only an entry with status `Completed`
or `Moved` uses `reference` instead, pointing to a Markdown document outside `plans/` with a
relative path such as `../docs/performance/input-latency.md`. A `Moved` entry's reference is the
plan that owns the work now, such as a Platform plan. Neither may contain `file`; other statuses
must not contain `reference` and retain every executable-plan check.

After the completion checks pass, move lasting contracts and evidence into the reference document
and delete the executable plan. Preserve its ID, metadata, dependencies, and original topics in
the inventory. Update its index row and live backlinks to the reference. The verifier still checks
IDs, index metadata, dependency cycles, topic coverage, and local links for completed entries.
