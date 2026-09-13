# Boot boundaries and a first-load gate

Status: proposed, implementation not started. Requested 2026-09-13. Depends on 106; scheduled after 108.

[Plan 106](106-boot-weight.md) establishes that the web app sends 2421 KB gzip of JavaScript before the first frame, 2311 KB of it in one chunk, and that this is not a bundler problem: [`vite.config.ts`](../apps/web/vite.config.ts) has no chunking configuration because **the application declares almost no loading boundaries**. Rolldown emits one chunk because the module graph is one graph.

This plan decides where the boundaries belong and pins the result. It runs after [107](107-workspace-markdown.md) and [108](108-markdown-modes.md) because both move the number, and a threshold pinned before them would be re-pinned twice. [Root PLAN.md](../PLAN.md) owns scheduling.

## Why this is last

| Reason                 | Detail                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The number is moving   | Plan 106 defers Mermaid and removes an icon font. Plan 107 removes an entire second Shiki installation and its ~200-grammar lazy map. Plan 108 adds a rendered pane. Three of the four change first load. |
| Boundaries follow data | Which feature deserves a boundary is answerable from Plan 106's per-package attribution and from nothing else. Guessing produces `React.lazy` in places that cost a spinner and save nothing.             |
| A gate needs a floor   | A threshold set against a number that is about to fall by a third teaches nothing and fires spuriously.                                                                                                   |

## Decisions

| Decision                                      | Proposed behavior                                                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 — boundaries live in source                | Loading boundaries are dynamic `import()` at points where a feature is genuinely absent from the first frame. No `advancedChunks`, no manual chunk map: splitting a boot-path chunk into several boot-path chunks changes file count, not transferred bytes. |
| D2 — "boot" is defined before it is optimized | The first frame of an IDE is not the first frame of a website. This plan writes down what must be on screen before the workspace is usable — and therefore what may not be deferred — before deferring anything.                                             |
| D3 — a boundary must pay for itself           | A candidate ships only if Plan 106's report shows a measured first-load reduction and the deferred load does not become visible as a stall in an interaction the user is already waiting on.                                                                 |
| D4 — deferred does not mean slow              | Anything moved behind a boundary is prefetched on a real signal — hover, focus, an open panel — not left to fault in on click. A boundary that turns an instant panel into a spinner has made the app worse.                                                 |
| D5 — every deferred state uses a real loader  | Per [AGENTS.md § Loading And Empty States](../AGENTS.md#loading-and-empty-states), a pending boundary renders one of the five primitives, branching on pending before empty. A new boundary is a new chance to ship a bare "Loading…".                       |
| D6 — the gate is a ratchet, not a target      | The gate pins the achieved number plus a small margin and fails a regression. It does not encode an aspiration. It lands only after the number stops moving.                                                                                                 |

## Phase 1 — define boot

No code. This phase produces the sentence everything else is measured against.

1. Write down what is on screen at first usable frame: which panes, which of them can be empty shells, and which must hold real content. The [instant workspace reload](085-instant-workspace-reload.md) plan already owns first-paint restoration and its conclusions are inputs here, not competitors.
2. Classify every top-level feature against that definition: required at boot, required on first interaction, or genuinely on demand.
3. Record which classifications are contested. A contested one is a product decision, not a bundling decision.

Completion: a written definition of boot and a classification table covering every feature directory.

## Phase 2 — candidates, from the report

1. **Rank by measured cost.** Take Plan 106's per-package first-load table, post-107, post-108, and intersect it with Phase 1's "not required at boot" set. That intersection is the candidate list; nothing outside it is considered.
2. **Hypotheses to test, not conclusions.** From the current reading, the plausible candidates are the chat feature and its markdown and math stack, the settings surface and `vscode-json-languageservice`, and the optional editor plugins (diff, minimap, LSP). Each is a hypothesis until the report ranks it.
3. **Estimate before implementing.** For each candidate, the expected reduction is read off the report first. A candidate whose predicted saving is under a threshold worth the code is dropped with that number recorded.

Completion: a ranked, costed candidate list with predicted savings and an explicit drop list.

## Phase 3 — land the boundaries

1. Implement the surviving candidates as source-level dynamic imports, one at a time, each with its before-and-after first-load number from Plan 106's command.
2. Add the prefetch signal for each (D4) and the pending state (D5).
3. Drop any candidate whose measured saving materially misses its prediction, and record why the prediction was wrong. A wrong prediction is information about the report.

Completion: each landed boundary has a recorded delta; the cumulative first-load reduction is reported against the pre-107 baseline.

## Phase 4 — the gate

1. Pin the achieved first-load gzip total plus a margin, using Plan 106's `--json` output.
2. Wire it into `verify` and CI beside the existing benchmark gates, following `bench:editor-typing:gate`'s shape — per-workspace baseline delta, never a bare root `bun run verify`.
3. The failure message names the packages whose contribution grew, not just the total. A gate that says "2.4 MB > 2.3 MB" sends the next person back to Plan 106's report by hand.

Completion: a first-load regression fails CI and names its cause.

## Verification boundaries

- Every claimed reduction comes from Plan 106's command, run against a real production build, before and after.
- Each boundary is checked in the browser for the interaction it defers: the deferred feature must not be visibly slower to reach than it is today.
- The gate is proven by a deliberate regression — add a static import of a deferred package, confirm CI fails and names it, revert.
- Never gate on a bare root `bun run verify`; use the per-workspace baseline delta.

## What this plan does not do

- No bundler configuration (D1).
- No re-measurement infrastructure. Plan 106 owns the instrument.
- No first-paint or restoration work. Plan 085 owns that.
- No dependency removals. Those belong to the plan that owns the dependency.
- No performance work beyond transferred bytes. Render throughput is a separate question with its own benchmarks.
