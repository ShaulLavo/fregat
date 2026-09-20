# Independent pane zoom implementation plan

Status: proposed, implementation not started. Grounded in checkout `3c9b88c3` and the Fable reference checkout.

Bring Fable's direct zoom gesture to the web workspace: point at a pane and pinch the trackpad, or hold Ctrl and scroll. That pane changes scale immediately and remembers the result.

The user requested independent pane zoom and trackpad support. The scope, limits, persistence model, and reset controls below are proposed implementation defaults.

## Preserve the interaction from Fable

Fable's `src/hooks/createInnerZoom.ts` installs a non-passive wheel listener on the target element. It intercepts `ctrlKey` events, prevents browser zoom, and persists a percentage under a named storage key. Its explorer and editor use separate keys. Each event changes the percentage by eight points, with a scale range of 50% to 450% of the base font size.

Use the same direct interaction. Normalize input magnitude instead of copying Fable's fixed jump per event. Verify physical trackpad pinch on the target browser; synthetic wheel events alone cannot establish that the device reaches the handler.

## Define what zoom belongs to

Give each logical tool its own scale: Files, Git, Search, Logs, Problems, and Chat. Switching sidebar tabs restores that tool's scale. Moving the tool between workbench and chat layouts preserves it.

Give each editor group its own scale. Tabs opened or moved into a group use that group's scale. A new split starts at its source group's scale, then changes independently. The two sides of a diff share their enclosing group's scale.

Give each terminal tab its own scale. Switching tabs restores it without recreating the terminal process. A new terminal starts at 100%.

Include editor-hosted tools such as Settings and Search in their editor group's zoom. The standalone Search pane retains its own scale. Avoid nested zoom owners: a mounted view gets exactly one owner from its composition context.

Scale content and its internal spacing, including chat's composer. Keep pane headers, tab strips, rails, split handles, and the window toolbar at their normal size. Floating menus, tooltips, and dialogs retain the app's normal scale. Editor completion and hover placement must still follow the caret correctly.

## Specify gestures and recovery

| Action                                           | Result                                          |
| ------------------------------------------------ | ----------------------------------------------- |
| Pinch over pane content                          | Smoothly change that pane's scale.              |
| Ctrl + wheel over pane content                   | Change that pane's scale.                       |
| Ordinary wheel or two-finger scroll              | Scroll normally.                                |
| Gesture over a header or outside a zoomable body | Keep existing browser behavior.                 |
| Zoom in or Zoom out in a pane menu               | Change the target pane by 10 percentage points. |
| Reset zoom in a pane menu                        | Restore 100% of the current base settings.      |
| Zoom command in the command palette              | Apply to the last focused pane.                 |

Use 100% by default and clamp to Fable's 50%–450% range. At a limit, continue consuming the owned zoom gesture so the browser does not suddenly zoom instead. A zero delta is a no-op.

Show the current percentage in the pane's existing menu alongside Zoom in, Zoom out, and Reset zoom. Expose these as keymap commands with clear accessible names. Leave shortcuts unbound initially to preserve browser zoom shortcuts. Retain the last focused pane when the command palette takes focus; opening another pane's menu explicitly targets that pane.

## Add one shared zoom boundary

Add a domain-free gesture helper and content wrapper under `packages/ui/src/patterns/`. Keep settings, pane identities, and persistence in the app layer. The wrapper accepts the effective scale and reports zoom intent through a narrow callback.

Attach one native wheel listener with `{ passive: false }` to the content boundary. Route events through their composed path so shadow-root editor and file-tree content participates. Resolve the nearest owner once. Do not apply both an inner and an outer handler, or steal gestures from a floating overlay.

Normalize pixel, line, and page deltas before computing a multiplicative scale change. Preserve small fractional changes across events. Treat sensitivity as internal input normalization, and tune it with an actual mouse and trackpad. Do not invent a new preference unless users need control over it; any exposed preference belongs in the registry.

Coalesce visible updates to animation frames. Keep transient gesture state in the narrow zoom owner, with no settings request per wheel event. Commit after the gesture settles, and flush the final intent when the owner changes or unmounts. Capture the owning workspace so an old gesture cannot write into the next workspace.

## Persist through the settings system

Register `workbench.paneZoom` in `packages/contracts/src/settings/keys.ts` in the same change that wires its consumers. Use a validated map of stable pane identities to percentages, an empty default, and window scope because the setting only changes presentation. Supply the normal cross-scope indicator and a usable settings representation.

Use semantic IDs for tool panes. Qualify editor-group and terminal-tab IDs with their existing workspace identity; those IDs alone must not collide across workspaces. Reuse restored group and tab IDs. Do not key zoom by DOM order, file path, or visible label. Remove overrides when their group or terminal is permanently removed; hiding a tool retains its value.

Read through `useSettingValue`. Route writes through the existing settings actions and serialized intent machinery. Serialize and merge map updates against the latest projected value so gestures in different panes cannot overwrite each other. Preserve other panes when resetting one pane.

Keep the temporary visual preview until the settings projection acknowledges it. On failure, restore the confirmed value and use the existing error UI and structured operation log. Do not leave an unsaved zoom looking durable.

Base appearance settings remain authoritative. At 100%, an editor uses `editor.fontSize` and `editor.lineHeight`; a terminal uses `terminal.integrated.fontSize`. A base-setting change recomputes every affected pane while preserving its percentage.

The current read hook and settings actions live inside the settings feature. Move shared access required by multiple features into the shared layer with their callers, following the two-consumer rule. Do not add feature-to-feature imports or enlarge the frozen import allowlist. Place app-specific zoom ownership under `apps/web/src/lib/pane-zoom/` only once it has the required consumers, with hooks, providers, state, and pure utilities separated.

Regenerate the settings schema and `docs/settings-reference.md` using the repository scripts.

## Scale each renderer correctly

Choose local metrics and theme-token overrides for the shipped implementation. Scaling only a parent's `font-size` misses rem-sized text and fixed row metrics. A transform also leaves layout measurements unchanged. Avoid either as a blanket solution.

| Renderer               | Integration and required proof                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared DOM panes       | Derive local text, line-height, icon, row-height, and spacing tokens from the unscaled density values. Preserve the four type-size steps and theme colors.             |
| Virtual lists          | Update the measured row height and invalidate virtualizer measurements. Verify visible rows, keyboard navigation, and scroll position after zoom.                      |
| File tree              | Pass effective metrics into its shadow-root sizing contract. Verify labels, hit targets, indentation, drag coordinates, and keyboard selection together.               |
| Editor groups          | Override editor font and line-height variables per group and trigger the editor's supported remeasurement path. Preserve independent scroll and selection state.       |
| Terminal tabs          | Pass effective font size through the existing terminal appearance path, then refit the grid and propagate the resulting dimensions. Keep the host and session mounted. |
| Chat and expanded logs | Remeasure variable-height content. Preserve the reading anchor, or stay pinned to the bottom if already following output.                                              |

Inspect the linked editor and terminal APIs before adding adapters. If they cannot react to local metric changes, extend their existing sizing contract instead of remounting the view. Build any changed linked package before verifying the app.

Keep a stable reading anchor through zoom: the first visible row or text position and its offset. At a clamped scroll boundary, accept the nearest possible position. Changing zoom must not edit text, clear selection, lose focus, or reset history.

## Implement in verifiable steps

1. Inventory content boundaries in both UI modes. Start with `features/workbench/components/sidebar-panel.tsx`, `bottom-panel.tsx`, `editor-groups-layout.tsx`, and `features/chat-mode/components/tool-pane.tsx`. Record how each body measures and scrolls.
2. Add the registry entry, identity model, persistence actions, and shared input boundary. Wire Files and Chat immediately so no inert preference ships. Verify that only the targeted pane changes.
3. Integrate editor groups and terminal tabs through their actual metric APIs. Verify two simultaneous editor groups at different scales, then switch between differently scaled terminals.
4. Cover Git, Search, Logs, Problems, and editor-hosted tools. Add menu actions and command-palette commands. Check both UI modes and persisted restoration.
5. Complete the browser scenario, focused checks, and deployment evidence below. Ship the complete interaction together.

Use existing header menus, including the composition around `use-pane-header-menu.ts`, for controls. Keep zoom policy out of the domain-free `ToolPane` primitive. Avoid prop chains through layout components by providing narrow pane actions at the ownership boundary.

## Verify the user path

Add `scripts/agent/scenarios/pane-zoom.ts`, selectors in `scripts/agent/selectors.ts`, and coverage in the verification feature map. Drive gestures and menu actions through the UI.

The scenario must establish these results:

- Zoom Files, Chat, an editor group, and a terminal independently. Record their measured metrics before and after and prove neighbors did not change.
- Scroll normally, pinch or Ctrl-scroll in both directions, reach both limits, and reset through a menu. Assert owned events prevent browser zoom and unowned events do not.
- Open two editor groups over the same document. Zoom one and confirm the other group's scale, text, and selection remain correct.
- Switch tools, terminal tabs, and UI modes. Reload and restore the same scales. Create a split and verify inheritance without later coupling.
- Change base editor and terminal font settings. Verify effective scale and reset behavior.
- Exercise long virtual lists, expanded logs, streaming chat, editor hit-testing, completion placement, and terminal selection after zoom. Include compact density.
- Zoom two panes rapidly and inspect persisted settings for both values. Exercise settings-write failure and a workspace switch during a gesture.
- Open a floating menu and confirm it remains normally sized, correctly positioned, and outside content gesture ownership.

Add focused tests for delta normalization, clamping, ownership, and concurrent settings-map updates because those can silently alter the wrong pane or lose a saved value. Use real browser tests for geometry and shadow-root routing. Do not substitute DOM-only tests for layout proof.

Run `bun run agent:browser scenario pane-zoom` against the existing dev server. Read the screenshots and structured logs. Use `caches` to verify final settings settlement. Capture a trace during sustained zoom to check for request floods and repeated full-workspace work; any performance improvement claim needs a comparable before trace.

Finish with a physical trackpad pinch check on the target browser. Record browser, device, and whether the gesture arrived as Ctrl-wheel. If the automation environment cannot supply physical input, mark that check pending explicitly. Add another event path only if the actual supported environment demonstrates a need, and prevent double handling.

Run the relevant typecheck, boundary lint, design census, and generated-settings checks. Deploy the completed web change with `bun run deploy --slug=pane-zoom --reason='Independent pane zoom'`. Use the server-restart option only if implementation actually requires server changes. Verify `/platform/release` and retain the live-check output.

Report the browser evidence directory, measured independence and restoration results, physical trackpad result, and served release. Completion requires readable, independently scaled panes with intact input and scrolling, not just a changing percentage.
