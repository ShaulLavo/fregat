# One owner per fact in the web app

Status: **PROPOSED — PHASE 1 READY; D1 NEEDS THE OWNER'S ANSWER.** Requested 2026-09-21. Inspected
at Platform `d1ca6472`. `apps/web/src` and the contracts it shares with the server.

Inside Platform's own code the same shape recurs that [plan 130](130-ask-the-editor.md) removes at
the Editor boundary: state is recovered from the DOM because its owner has no API, a constant is
written in several files that must agree, or a timer stands in for a notification.

## What is on the table

DOM as a data channel:

| #   | Where                                                                   | What is recovered from the DOM                                                                                                                                                                                                                                                                                                                                                      | Verified |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `lib/documents/state/group-geometry.ts`                                 | Whether an editor group can split, by scanning for `[data-editor-group-id]`. An unmounted group reads as "not allowed". `main.tsx:82` wires it into navigation at boot, before any group is mounted; `keymap/workspace-commands.ts:171` has the same failure for the split binding. A `lib/` module depending on an attribute a feature component stamps is also a layer inversion. | yes      |
| 2   | `features/workbench/state/editor-drop-target.ts:55-78`                  | The drop target's box and the hovered tab's box, re-derived by selector while dnd-kit's `over` already carries the measured rect. A null degrades silently to a no-op or a wrong insertion index.                                                                                                                                                                                   | no       |
| 3   | `features/workbench/state/tab-strip-metrics.ts:44-56, 158-166`          | The tab id list, read twice from the DOM as a cache signature. The workspace store owns the list and its order. Line 120 also omits the `CSS.escape` that `editor-drop-target.ts:76` applies to the same selector.                                                                                                                                                                  | no       |
| 4   | `features/command-palette/hooks/use-highlighted-palette-value.ts:36-38` | The highlighted row, from cmdk's `data-selected` through a `MutationObserver` and a microtask.                                                                                                                                                                                                                                                                                      | no       |
| 5   | `features/command-palette/hooks/use-files.ts:66-67`                     | A global `document.querySelector('[data-slot="command-list"]')` to reset scroll, under the author's own "this seems a bit hacky" TODO.                                                                                                                                                                                                                                              | no       |
| 6   | `features/chat/utils/markdown-clipboard.ts:14-151`                      | `select-none` and `sr-only` Tailwind classes read back as a "do not copy" contract. The file already uses `data-markdown-copy` for the same job.                                                                                                                                                                                                                                    | no       |
| 7   | `features/workbench/state/wallpaper-query.ts:46-57`                     | Preload status from a dataset value on a `<link>`; an unknown link reads as `pending` forever.                                                                                                                                                                                                                                                                                      | no       |
| 8   | `features/chat-mode/state/notification-host.ts:171-178`                 | Removes the page's favicon link and appends its own, keeping the original in a closure. Two owners of one element.                                                                                                                                                                                                                                                                  | no       |
| 9   | `features/workspace/utils/file-tree-prefetch.ts:19-31`                  | Row paths from the tree library's own `data-item-path`.                                                                                                                                                                                                                                                                                                                             | no       |
| 10  | `features/editor/components/frame.tsx:47`                               | `closest('.app-editor-host')` decides whether a press closes the overlay.                                                                                                                                                                                                                                                                                                           | no       |

Mirrors that must agree:

| #   | Where                                                                                                                            | The copies                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 11  | `features/settings/hooks/use-workbench-density.ts:17`, `apps/web/index.html:20-59`, `lib/settings-boot-mirror.ts:18-20`          | Density is resolved by the contracts default, an inline boot script that re-implements the localStorage read, the `data-density` attribute it stamps, and a hook that reads the attribute back. Nothing type-checks the inline copy. |
| 12  | `features/search/utils/providers.ts:22`, `apps/server/src/fs/contracts.ts:16`, `packages/contracts/src/settings/keys.ts:593,604` | The search cap of 20000, four times.                                                                                                                                                                                                 |
| 13  | `features/search/utils/preview-length.ts:3-5`, `features/workbench/hooks/use-active-tab-strip-scroll.ts:10-11`                   | Pixel constants re-deriving CSS layout (`84`, `62`, `7`, and a gutter of `8` that "matches the strip's px-2").                                                                                                                       |

Timing standing in for a notification:

| #   | Where                                                                                                | The wait                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 14  | `features/chat/components/timeline-viewport.tsx:147-158`                                             | A double `requestAnimationFrame` for a disclosure to finish expanding.                                          |
| 15  | `hooks/use-element-width.ts:14-21`                                                                   | Re-schedules itself every frame until `ref.current` is non-null, for the component's whole life if it never is. |
| 16  | `features/chat/components/chat-input.tsx:389-397`, `features/chat/hooks/use-composer-inbox.ts:64-65` | The same one-frame focus delay, copied.                                                                         |
| 17  | `features/editor/hooks/use-diff-panes.ts:27-88`                                                      | Scroll echo guessed by position match. Its Editor half is the `onDidScroll` row of E050.                        |

And one that is a missing feature, not a workaround:

| #   | Where                                            | What happens                                                                                                         |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 18  | `features/workspace/hooks/use-events.ts:829-834` | A file changing on disk replaces the user's unsaved edits and then shows a toast, under `TODO(conflicts)`. Verified. |

Small, recorded: `features/settings/hooks/use-has-workspace.ts:26,33` fabricates a store through
`as unknown as`; `lib/optimistic/hold-diagnostics.ts:59` scans the document for `role="status"` as a
guard about another layer's rendering.

## Decisions

- D1 (**owner**): item 18 loses data. It can be a phase here (a conflict record the editor renders,
  with the event applier consulting the document store's dirty state before it overwrites), or its
  own plan with a proper conflict view. Recommendation: its own plan, scheduled ahead of this one's
  later phases, because it needs UI design and this plan is otherwise mechanical.
- D2: group geometry is a registry owned by the workbench. `editor-group.tsx` registers
  `groupId → size` from its ref callback into the workspace store. `canSplitGroup` takes a size and
  returns "unknown" distinctly from "no", and boot-time navigation treats unknown as allowed and
  re-checks on mount.
- D3: the inline boot script is generated from the settings module at build time. The attribute is a
  one-way output; nothing reads it back.
- D4: a platform-owned `data-*` attribute used for event delegation on a component's own list is
  fine and stays. The test is whether the reader could have been given the value by its owner.

## Phase 1 — geometry registry (items 1, 2, 3)

Per D2. The drop target reads dnd-kit's `over.rect` and the registry. The tab-strip cache keys on a
store revision. Scenario: a deep link that asks for an edge placement opens split on a cold load.

## Phase 2 — one source per constant (items 11, 12, 13)

The search cap is exported from `@workspace/contracts` and imported by the route, the settings
schema and the client. The boot script is generated per D3. Preview length measures the box it
already observes instead of assuming pixel widths.

## Phase 3 — notifications instead of timers (items 14, 15, 16)

`ResizeObserver` or `transitionend` for the disclosure. A callback ref in `use-element-width`. One
`focusAfterInsert` helper, and a post-commit callback if the composer's editor offers one.

## Phase 4 — the remaining DOM channels (items 4 to 10)

Each is small and independent. Item 4 first checks whether an uncontrolled cmdk `Command` exposes
`onValueChange`, which would remove the observer outright.

## Verification

Phase 1 by the new scenario and `look`. Phase 2 by typecheck plus a `look` at compact and cozy
density on a cold load, because the inline script runs before any module. Phases 3 and 4 by `look`
on each touched surface. `bun run gates` stays green throughout.

## What this plan does not do

It leaves alone the sites the audit checked and found legitimate: `aria-activedescendant`
forwarding and event delegation over a component's own list, `lib/platform/backdrop.ts` reading its
own attribute, `features/terminal/utils/commands.ts` sequencing against ghostty's click handler, and
the settings boot mirror's design, of which only the `index.html` duplicate is a problem.
