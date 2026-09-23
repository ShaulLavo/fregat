# One owner per fact in the web app

Status: **PHASES 1–3 IMPLEMENTED 2026-09-23; PHASE 4 PROPOSED. D1 moved to Plan 134.** Requested 2026-09-21. Inspected
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

Done 2026-09-23. `features/workbench/state/group-geometry.ts` holds `groupId → size` from one
`ResizeObserver`; `editor-group.tsx` registers from its ref callback, and
`lib/documents/state/group-geometry.ts` is deleted. The registry is a module store rather than the
workspace store: sizes are not workspace state and must not persist. `groupSplitVerdict` answers
`allowed`, `too-small` or `unknown`; navigation, the split commands and the tab menu refuse only
`too-small`, and the menu re-reads when a group registers. The drop target reads `over.rect` for both
the content overlay and the hovered tab. The tab strip is told the store's tab order in a layout
effect and answers only when it measured under that order.

No address carries a placement, so the cold-load case is a split requested while no group is
mounted. `scenario editor-split-unmounted` splits from chat mode with the editor tool closed; before
this phase the command declined and left the palette open. `scenario editor-tab-reveal` covers the
strip cache.

## Phase 2 — one source per constant (items 11, 12, 13)

The search cap is exported from `@workspace/contracts` and imported by the route, the settings
schema and the client. The boot script is generated per D3. Preview length measures the box it
already observes instead of assuming pixel widths.

Done 2026-09-23. `WORKSPACE_SEARCH_LIMIT_MAX` in `@workspace/contracts` feeds the route, both
settings schemas and the client. The inline script is `apps/web/src/boot-appearance.ts`, bundled
by `scripts/boot-appearance-plugin.ts` into a 2.7 KB classic script. It reads its defaults from
`settings/boot-defaults.ts`, which the registry also uses, and its storage keys from
`lib/boot-keys.ts`. The desktop check is `resolveBackdrop`. Nothing read `data-density` back
except `useWorkbenchDensity`, and that had no production caller. The hook, its boot context and the
`bootDensity` prop chain are deleted. Search preview length comes from one `ResizeObserver` over
the rows' preview cells, with the glyph width taken from the cell's font. The tab strip's 8 px gutter
matched no `px-2`. It is now the strip's `scroll-px-2`, read back as `scroll-padding`.
`visual-search-headers` failed (`-786 !== 2`) on the release before this phase as well. The scenario
measured rows the editor had retired with `hidden`. The shared `excerpt` selector now skips them.

## Phase 3 — notifications instead of timers (items 14, 15, 16)

`ResizeObserver` or `transitionend` for the disclosure. A callback ref in `use-element-width`. One
`focusAfterInsert` helper, and a post-commit callback if the composer's editor offers one.

Done 2026-09-23. Disclosures do not animate, so the wait is for a measurement. A `ResizeObserver`
on the clicked row reports after the virtualizer's own observer, because observers report in
creation order. The viewport is read in the layout effect of the next commit, since the
virtualizer re-renders after its observer returns. The happy-dom timeline test only passed
before because a virtualizer frame reset an unclamped `scrollTop` of −488 first. Its layout
stubs now clamp `scrollTop` the way a browser does, and `test/env/resize-observer.ts` sends the
initial report. `useElementWidth` returns a callback ref and measures in the commit that attaches
the element. Lexical has the post-commit callback: `insertChatInputText(…, { focus: true })`
focuses from the update's `onUpdate`, so both copies of the frame delay are gone.
`scenario chat-disclosure-settle` and `scenario chat-composer-insert` cover the three surfaces.
The drop is synthesized with the tree's payload, because Playwright's `dragTo` never completes a
tree drag onto the composer.

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
