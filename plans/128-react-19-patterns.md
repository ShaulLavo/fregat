# Plan 128: Hiding a pane, addressing children, and the sync lane

Status: proposed, implementation not started. Requested 2026-09-20. Planned against Platform
`b915d3e0`, with substantial unrelated working changes present in orchestration, chat, chat-mode,
provider, `packages/contracts` and TUI files.

This plan establishes three React patterns, applies each to a small proven set, and writes down the
guidance that makes each one the default for the code written after it. It does not own the repairs
it names: compiler bailouts, the two `ref={focusTarget.ref}` destructures, the stage/unstage
settlement and the one-capture-per-palette-keystroke change belong to
[Plan 127](127-compiler-and-lifetime-repairs.md); transferred bytes and loading boundaries belong to
[Plan 109](109-boot-boundaries.md) and [Plan 106](106-boot-weight.md); async effect ownership is
already settled by [Plan 118](118-async-effects-through-tanstack.md).

Root `PLAN.md` owns scheduling. This plan owns its internal execution order and does not reorder
other work.

Priority: P2. Effort: L. Risk: medium, because two prerequisites reach into `packages/tree` and the
linked `Editor` checkout, and because the census below is a source read whose adversarial review
overturned 34 of 46 classifications.

## The premise

A fix applied once comes back. `{terminalActive ? <TerminalTabs /> : <DiagnosticsPanel />}` reads
like a tab switch in every codebase anyone has worked in, and in this one it detaches every PTY and
lets the server kill every shell ten minutes later. `ref={focusTarget.ref}` reads like binding a ref,
and it costs the component its compiler memoization. Neither is a mistake a careful person avoids.
Both are mistakes the repository failed to make visible.

So the unit of work is the pattern, a small set of sites that prove it, and the named exemplar that
makes the wrong spelling stop being the obvious one. Three patterns, in dependency order: the
resource rule, which decides whether a subtree may be hidden at all; Fragment Refs, which delete the
wrapper element that exists only to be measured or focused; and the sync lane, which is the
constraint that stops someone spending a week on scheduling that cannot work here.

## A. The resource rule, and hiding instead of unmounting

### The rule

`<Activity mode="hidden">` preserves `useState` and `useReducer` and destroys effects. That is the
whole test. **A subtree may be hidden with `Activity` only when nothing it owns lives in an effect's
cleanup.** An effect may attach a view to a resource something else owns; an effect that _creates_
the resource has turned every future render decision into a lifetime decision.

The repository contains both halves of the answer. `features/chat/state/active-transports.ts` holds
chat's transports in a module map and `state/application-runtime.ts:50` instantiates the editor
runtime once, so `features/editor/providers/state-provider.tsx:62` reduces to a `resume()`/`suspend()`
pair and a tab switch keeps your text and your undo stack. Against that,
`packages/tree/src/hooks/useFileTree.ts:63` schedules `model.cleanUp()` from an effect cleanup on a
1 ms timer and `packages/editor-react/src/index.ts:219` returns `controller.scheduleReactDispose()`,
so both die on a hide that lasts longer than a frame.

### What the review overturned, and why

46 classifications were re-checked adversarially and **34 were overturned** — not always the label,
often the reason, the prerequisite or the blast radius, and in eleven cases all three. The dominant
cause was not effect teardown. It was that a hidden `Activity` applies `display: none !important`,
and nearly every pane in this app measures itself:

| Measurement site                                               | What it reads                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `@base-ui/react/collapsible/panel/useCollapsiblePanel.mjs:310` | `element.scrollHeight`, to derive `--collapsible-panel-height`                    |
| `packages/ui/src/patterns/use-listbox.ts:116-117`              | A row's `offsetHeight` and the container's `clientHeight`, to compute a page step |
| `packages/ui/src/patterns/virtual-list.tsx:157`                | `virtualizer.measureElement` per row when `measureItems` is set                   |
| `packages/tree/src/components/FileTreeView.tsx`                | Row geometry inside the shadow root, on its own virtualizer                       |

Two conclusions follow, and they are conclusions rather than opinions.

**A shared primitive cannot own the boundary.** Safety under `display: none` is a property of
`children`, not of the wrapper. A `PaneStack` or `HiddenPane` component in `packages/ui` that stacks
layers and hides the inactive one would be correct for a diagnostics list and silently wrong for a
tree, an editor or any Base UI collapsible, and the wrapper cannot tell which it was handed. The
shape is a call-site pattern with a named exemplar — `terminal-tabs.tsx:51-56`, where every terminal
tab stays mounted in an `absolute inset-0` layer and the inactive ones carry `invisible` and `inert`
— not a new export. This plan therefore adds no primitive.

**`ResizablePanel` is itself a resource-in-effect.** `react-resizable-panels@4.12.4` keeps a
per-panel-id-set layout cache: `mutableState.layouts[key]` is read at
`react-resizable-panels.js:1496` and written at `:1745`, keyed by the set of panel ids currently
registered. Unregistering a panel changes the key, so every "collapse the panel" site is more than a
wrap — the panel has to stay registered and go to zero size, which is a size change, not a
visibility change.

Scroll is the third consequence and it is separate from measurement. A scroll container that loses
its layout box loses `scrollTop`, and React restores nothing — `hideInstance` in `react-dom-client`
sets one style property. So `Activity` preserves component state and destroys scroll position. Any
offset that must survive is held outside the DOM, the way `features/git/components/history-list.tsx`
holds it with `initialOffset` plus an `onScrollEnd` write into navigation state.

The terminal is the one case where the repository's own comment overstates the danger.
`terminal-tabs.tsx:14` says "a display:none host measures 0×0 so the grid comes back wrong". Ghostty
does not do that: `contentBoxSize` in `/work/projects/ghostty-webgpu/src/dom/fit.ts:214` returns
`undefined` when width or height is 0, `calculateFit` returns `undefined` in turn, and `runFit`
bails without calling `onFit`, so a zero-size read is discarded and the last good grid is retained
until the `ResizeObserver` refits. A terminal is disqualified from `Activity` by its effect cleanup,
not by its measurement. Reasoning by analogy from that comment produced four wrong classifications.

Three shapes are not `Activity` questions at all and are filed here so nobody re-proposes them:

- A **keyed remount on identity change** (`key={rootPath}`, `key={active.origin}`, `key={prompt.id}`)
  is correct. A tree for root A must not survive into root B.
- A **semantic rollback in a cleanup** is disqualifying in the other direction.
  `features/settings/components/widgets/palette-editor.tsx:91` restores the live palette on unmount
  and `features/command-palette/components/content.tsx:159-167` clears four previews. Hiding those
  runs the rollback while retaining the draft, so the theme snaps back and then reappears.
- A **virtualizer overscan unmount** cannot be reached by any hidden-mount trick, because
  `VirtualList` does not render the row at all. `features/chat/components/proposed-plan-card.tsx:28`
  and its siblings are store moves, not `Activity` moves.

### What each unmount costs today

157 conditional-render and keyed-remount sites were read across `features/workbench`,
`features/chat-mode`, `features/chat`, `features/git`, `features/logs`, `features/settings`,
`features/editor`, `features/environments`, `packages/tree`, `packages/ui` and `packages/markdown`.

| Sites | Classification                                                            |
| ----: | ------------------------------------------------------------------------- |
|    84 | leave-as-is — the unmount is correct, or there is nothing to lose         |
|    28 | activity-safe — hideable today                                            |
|    27 | activity-after-refactor — a resource or a scroll offset has to move first |
|    13 | visibility-inert — must stay mounted and keep a real layout box           |
|     5 | needs-investigation — the source did not settle it                        |

The 23 Fragment Ref candidates in section B are a separate census and are not in that total.

The rows below are the ones that carry a decision or a lesson, deduplicated by file and line, plus
one class row standing for fifteen stateless affordance swaps. The leave-as-is rows are the point of
the table: the denominator is what tells a reader that a handful of sites are worth changing and a
hundred are not. Six rows are labelled `not-an-Activity-site` — a remount bug or a layout gesture
wearing a ternary — which is a reading of the site, not a sixth bucket.

| Site                                                                              | What dies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | What the user sees                                                                                                | Classification          | Prerequisite                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/features/workbench/components/bottom-panel.tsx:65`                  | Every PTY socket, every ghostty instance, scrollback, the session-registry entry                                                                                                                                                                                                                                                                                                                                                                                                               | Clicking **Problems** kills every shell ten minutes later, with nothing on screen saying a process died           | visibility-inert        | ToolPane body needs `relative`; both branches `absolute inset-0`                                                                                                   |
| `apps/web/src/features/workbench/components/layout.tsx:96`                        | The same chain, via `BottomPanel`                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Collapsing the panel for screen space arms the same ten-minute kill                                               | visibility-inert        | Fix with `:65` in one pass, or no shell survives a tab click. Both are Plan 127 Phase 3, ranks 1 and 2, not this plan                                              |
| `apps/web/src/features/chat-mode/components/tool-pane.tsx:82`                     | The session terminal's socket and ghostty instance; the fallthrough branch of a seven-way switch                                                                                                                                                                                                                                                                                                                                                                                               | Glance at Git for ten minutes and the session's shell and its running command are gone                            | visibility-inert        | `active` must become `tab === 'terminal'` once panes stay mounted                                                                                                  |
| `apps/web/src/features/workspace/components/view.tsx:22`                          | The entire opposite surface: terminals, editors, tree model, every pane scroll                                                                                                                                                                                                                                                                                                                                                                                                                 | Toggling Workbench ↔ Chat rebuilds the whole IDE; ten minutes in chat kills every workbench shell                 | visibility-inert        | Both arms hold a `TerminalPanel`; stack them in the already-`relative` wrapper                                                                                     |
| `apps/web/src/features/terminal/components/panel.tsx:296`                         | The terminal host div, with the ghostty instance and socket already torn down by the gated effect                                                                                                                                                                                                                                                                                                                                                                                              | "The terminal will reconnect when the machine is available" — and reconnecting gives a fresh shell                | visibility-inert        | Render the notice as an overlay, as `:330-343` already does for loading                                                                                            |
| `packages/tree/src/hooks/useFileTree.ts:63`                                       | `FileTreeController.destroy()`: the path-store subscription, every mutation listener, every item handle                                                                                                                                                                                                                                                                                                                                                                                        | Expansion, scroll, filter text and selection all reset                                                            | visibility-inert        | `useState` holds the model, so a destroyed instance is handed straight back on reveal                                                                              |
| `packages/tree/src/components/FileTree.tsx:175`                                   | The inner `createRoot` React root inside the shadow host, and everything `FileTreeView` holds                                                                                                                                                                                                                                                                                                                                                                                                  | Rows blank and re-window from the top; an in-flight rename is discarded                                           | visibility-inert        | A second teardown, independent of the 1 ms timer                                                                                                                   |
| `apps/web/src/features/workspace/components/tree-pane.tsx:76`                     | The whole `FileTree` model, whenever the tree query leaves `ready`                                                                                                                                                                                                                                                                                                                                                                                                                             | A status dip collapses the tree to a skeleton and loses the focused row                                           | visibility-inert        | `resetTreeLoad` is dead code — defined at `use-tree.ts:42`, returned at `:144`, called nowhere — so the live trigger is a root change that already remounts by key |
| `packages/editor-react/src/index.ts:219`                                          | `editor.dispose()`, document state, option sync, every synced plugin                                                                                                                                                                                                                                                                                                                                                                                                                           | Find query, tokenizer session and LSP registration are rebuilt per tab switch                                     | visibility-inert        | The editor measures continuously and `suspendEditor()` empties the store synchronously on hide                                                                     |
| `packages/editor-react/src/index.ts:230`                                          | The same teardown, from the host-element side                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Same                                                                                                              | visibility-inert        | Lifetime is exported API in a separate repo; see Phase A5                                                                                                          |
| `packages/ui/src/components/accordion.tsx:49`                                     | A collapsed section's children unless the consumer passes `keepMounted`                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing today — one consumer, static content, `keepMounted` already set                                           | visibility-inert        | Base UI derives the panel height from `scrollHeight`, which is 0 under `display:none`                                                                              |
| `apps/web/src/features/workbench/components/sidebar-panel.tsx:89`                 | Per branch: the tree model; the live log stream; the chat shell stream; list scroll on all five                                                                                                                                                                                                                                                                                                                                                                                                | Files → Git → Files collapses the whole tree; the highest-frequency unmount in the app                            | activity-after-refactor | Five branches, four different answers; see Phases A2–A4                                                                                                            |
| `apps/web/src/features/chat-mode/components/tool-pane.tsx:64`                     | The `FileTree` controller, plus two per-mount vanilla stores                                                                                                                                                                                                                                                                                                                                                                                                                                   | Directory expansion and tree scroll reset on every return to Files                                                | activity-after-refactor | Both `packages/tree` teardowns, not the one the census named                                                                                                       |
| `apps/web/src/features/chat-mode/components/tool-pane.tsx:65`                     | An in-flight commit-message generation, aborted by a cleanup-only effect                                                                                                                                                                                                                                                                                                                                                                                                                       | The sparkle button returns disabled with a spinner and no recovery path                                           | activity-after-refactor | `useGenerateCommitMessage` needs a `mutationKey`; in-flight state through `useIsMutating`                                                                          |
| `apps/web/src/features/chat-mode/components/stage-body.tsx:56`                    | Per-session timeline reducer and virtualizer offset, composer caret, pending-request drafts                                                                                                                                                                                                                                                                                                                                                                                                    | Switch away from a conversation you were reading half-way up and you land at the bottom                           | activity-after-refactor | The timeline must own its scroll offset; `Activity` does not preserve a scroll box                                                                                 |
| `apps/web/src/features/chat/components/messages-timeline.tsx:25`                  | `followMode`, the prepend anchor, and with them the virtualizer's position                                                                                                                                                                                                                                                                                                                                                                                                                     | The single most-noticed loss on a session switch                                                                  | activity-after-refactor | Persist an anchor id plus offset and feed it as `initialOffset`                                                                                                    |
| `apps/web/src/features/chat/components/side-panel-content.tsx:19`                 | A second, unmanaged shell stream — an `AbortController`, a wake supervisor and a supervised loop                                                                                                                                                                                                                                                                                                                                                                                               | Leaving the Chat sidebar tab restarts the connection banner from "connecting"                                     | activity-after-refactor | Delete the subscription; read the phase from `useEnvironmentsStore`, its real owner                                                                                |
| `apps/web/src/features/chat/components/side-panel-content.tsx:66`                 | Timeline scroll, composer caret, pending-request drafts, in the narrower sidebar                                                                                                                                                                                                                                                                                                                                                                                                               | Same losses as the stage, on every sidebar session switch                                                         | activity-after-refactor | Convert with `stage-body.tsx:56` so the two surfaces do not diverge                                                                                                |
| `apps/web/src/features/chat/components/chat-view.tsx:126`                         | `MessagesTimeline`, the composer and the pending panels, mid-life, on a transient projection gap                                                                                                                                                                                                                                                                                                                                                                                               | A checkpoint revert flashes a live conversation to a skeleton and returns scrolled to the bottom                  | activity-after-refactor | Same scroll contract; overlay the loader instead of swapping the tree                                                                                              |
| `apps/web/src/features/settings/components/page.tsx:201`                          | The real `<Editor>` behind the JSON view, or every settings row's local draft                                                                                                                                                                                                                                                                                                                                                                                                                  | Clicking Defaults and back rebuilds the JSON editor and drops your place in the file                              | activity-after-refactor | The editor seam; everything else here is already in module stores                                                                                                  |
| `apps/web/src/features/editor/components/compare-saved-view.tsx:88`               | Two diff `Editor` instances, re-created on the next divergent keystroke                                                                                                                                                                                                                                                                                                                                                                                                                        | A Compare-with-Saved tab thrashes between two live editors and an empty state while typing                        | activity-after-refactor | The editor seam; the only churn-by-keystroke unmount found                                                                                                         |
| `apps/web/src/features/editor/components/compare-saved-view.tsx:70`               | Both diff panes while the saved side refetches                                                                                                                                                                                                                                                                                                                                                                                                                                                 | A file re-read blanks the comparison and re-tokenizes on return                                                   | activity-after-refactor | Same as `:88`, lower priority                                                                                                                                      |
| `apps/web/src/features/editor/hooks/use-diff-language.ts:115`                     | An LSP session: one lane per matched server, with `didOpen`ed phantom documents on both sides                                                                                                                                                                                                                                                                                                                                                                                                  | Hover and go-to-definition stop answering on a diff until the session rebuilds                                    | activity-after-refactor | Refcounted registry keyed by path, root and lane set, mirroring the existing connection pool                                                                       |
| `packages/ui/src/patterns/tool-pane.tsx:40`                                       | The pane body's whole subtree whenever `state.pending` flips                                                                                                                                                                                                                                                                                                                                                                                                                                   | Only two of eleven consumers pass `state` at all, both with `isPending`, so there is no prior state to lose today | activity-after-refactor | The boundary belongs at the call site; a primitive cannot know what `children` holds                                                                               |
| `apps/web/src/components/use-pick-entry.tsx:68-79`                                | The picker's navigation history, current path, search query and selection                                                                                                                                                                                                                                                                                                                                                                                                                      | Cancel three folders deep and reopening starts at the home directory                                              | activity-after-refactor | `useServerInfoForOpen` resets the session on `!open`; `Activity` would only silence it                                                                             |
| `apps/web/src/features/workbench/components/file-editor-body.tsx:160`             | The references pane's `collapsedPaths` and `activeId`                                                                                                                                                                                                                                                                                                                                                                                                                                          | Reopening on a new symbol would inherit the old query's collapse set                                              | activity-after-refactor | Needs a latch for a null-able result; not worth doing — drop it                                                                                                    |
| `apps/web/src/features/workbench/components/diagnostics-panel.tsx:42`             | The diagnostics list scroll and expanded row                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Switching to a file with no language server resets the Problems list                                              | activity-after-refactor | Would preserve a stale file's diagnostics; not worth doing — drop it                                                                                               |
| `apps/web/src/features/chat-mode/components/stage-body.tsx:28`                    | The previous `ChatView`, while a session resolves                                                                                                                                                                                                                                                                                                                                                                                                                                              | The stage flashes to a loader between sessions                                                                    | activity-after-refactor | `resolving` carries `sessionId: null`, so the key changes anyway; needs a keyed pool                                                                               |
| `apps/web/src/features/chat-mode/components/tool-pane.tsx:66`                     | The live log SSE stream and the panel's `inspection` and `now` state                                                                                                                                                                                                                                                                                                                                                                                                                           | Log tail restarts from a fresh fetch; filters survive in a module store                                           | activity-safe           | None. `logsKeys` has no consumer outside the feature and the reveal refetch covers the gap                                                                         |
| `apps/web/src/features/logs/components/panel.tsx:41`                              | The same stream, from the hook side                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Events arriving while away are not in the cache on return                                                         | activity-safe           | Use the existing `active` prop; both call sites hardcode `active` today                                                                                            |
| `apps/web/src/features/chat-mode/components/tool-pane.tsx:67`                     | Nothing but a focus registration and a listbox cursor                                                                                                                                                                                                                                                                                                                                                                                                                                          | Nothing                                                                                                           | activity-safe           | Near-zero payoff: the body's scroll is lost either way                                                                                                             |
| `apps/web/src/features/chat-mode/components/tool-pane.tsx:78`                     | The pane's focus registration and scroll offset; results live in `SearchRuntime` one layer up                                                                                                                                                                                                                                                                                                                                                                                                  | Scroll position in a long result list, and the caret in the search field                                          | activity-safe           | Contingent: safe only because `use-row-height.ts` guards `measured > 0`                                                                                            |
| `apps/web/src/features/chat-mode/components/layout.tsx:63`                        | The rail's keyboard cursor and list scroll; everything durable is already in module stores                                                                                                                                                                                                                                                                                                                                                                                                     | Barely anything; the cursor resolves back to the active session                                                   | activity-safe           | Must wrap the `ResizablePanel`/`ResizableHandle` pair, and the panel must stay registered                                                                          |
| `apps/web/src/features/settings/components/raw-conflict-banner.tsx:99`            | Scroll position inside two `<pre>` comparison blocks                                                                                                                                                                                                                                                                                                                                                                                                                                           | Hide and re-show compare and you are back at the top of a diff you were reading                                   | activity-safe           | None. No resource, no measurement, no portal                                                                                                                       |
| `apps/web/src/features/settings/components/widgets/wallpaper-widget.tsx:35`       | The picker's scroll, selected tile and upload tile state                                                                                                                                                                                                                                                                                                                                                                                                                                       | Reopening starts at the top of the library                                                                        | activity-safe           | Confirm the Base UI portal is not `keepMounted`, or the dialog's virtualizer meets `display:none`                                                                  |
| `apps/web/src/features/chat/components/pending-user-input-card.tsx:23`            | A part-answered agent question: every option picked, every free-text answer, the step index                                                                                                                                                                                                                                                                                                                                                                                                    | The agent is blocked waiting, you check another session, and a five-question form is blank                        | activity-safe           | Reached through the `stage-body.tsx:56` conversion                                                                                                                 |
| `apps/web/src/features/chat/components/pending-user-input-panel.tsx:7`            | The card above, when the derived pending list momentarily empties                                                                                                                                                                                                                                                                                                                                                                                                                              | The half-filled form clears on a projection tick                                                                  | activity-safe           | Render the card hidden rather than returning null                                                                                                                  |
| `apps/web/src/features/chat/components/chat-runtime-status.tsx:28`                | Which runtime error notices were dismissed, and the detail toggle                                                                                                                                                                                                                                                                                                                                                                                                                              | A dismissed error reappears after switching sessions and back                                                     | activity-safe           | Reached through the same conversion                                                                                                                                |
| `apps/web/src/features/chat/components/timeline-viewport.tsx:152`                 | The scroll container, the virtualizer's measurement cache, an open Agents dialog                                                                                                                                                                                                                                                                                                                                                                                                               | A checkpoint revert that empties the timeline drops the reader to the welcome screen                              | activity-safe           | Render the welcome view as a sibling overlay                                                                                                                       |
| `apps/web/src/features/chat/components/chat-input.tsx:402`                        | The Lexical editor: caret, selection, undo history, IME composition, mention nodes                                                                                                                                                                                                                                                                                                                                                                                                             | Mid-sentence the caret jumps to the end and Ctrl+Z stops reaching earlier text                                    | activity-safe           | Nothing of its own; only reachable once the parent stops changing its key                                                                                          |
| `apps/web/src/features/editor/providers/state-provider.tsx:62`                    | Nothing. `suspend()`/`resume()` is a pause over a registry-owned runtime                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing                                                                                                           | activity-safe           | The model the rest of this plan copies                                                                                                                             |
| `packages/ui/src/patterns/use-row-height.ts:6`                                    | The measuring probe and its `ResizeObserver`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Nothing                                                                                                           | activity-safe           | Contingent on `if (measured > 0)`; a future measurement without that guard flips it                                                                                |
| `packages/markdown/src/hooks/use-highlighted-code.ts:35`                          | Only an in-flight callback guard; tokens land in a module-level LRU                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing                                                                                                           | activity-safe           | The shape every other package should be refactored towards                                                                                                         |
| `apps/web/src/features/chat/components/chat-view.tsx:120`                         | One refcount on a module-registry session-detail stream                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing; a running turn pins the entry and a reconnect resumes from `afterSequence`                               | activity-safe           | Recorded because it is the fact that makes the chat side cheap                                                                                                     |
| `apps/web/src/features/environments/components/connection-gate.tsx:33`            | Potentially everything: the gate sits above every provider and the whole workspace view                                                                                                                                                                                                                                                                                                                                                                                                        | A transient blip would look like the app restarting, and detach every shell                                       | needs-investigation     | Establish whether `known` can go true → false at runtime                                                                                                           |
| `apps/web/src/components/logging-error-boundary.tsx:54`                           | The whole tree under `main.tsx:91` on any caught render error                                                                                                                                                                                                                                                                                                                                                                                                                                  | A render bug in a breadcrumb popover silently starts the shell-kill timer for every terminal                      | needs-investigation     | Decide whether pane-level boundaries contain the blast radius                                                                                                      |
| `apps/web/src/features/chat-mode/components/tool-pane.tsx:54`                     | The whole editor group tree, and per-document view session state                                                                                                                                                                                                                                                                                                                                                                                                                               | Unknown without reading the editor layer                                                                          | needs-investigation     | `CodePanel` is a passthrough; the answer is in `packages/editor-react`                                                                                             |
| `apps/web/src/features/workbench/components/editor-surface-tab-body.tsx:234`      | On one reading nothing, on the other the editor controller for a settings ↔ file flip                                                                                                                                                                                                                                                                                                                                                                                                          | Two reviews disagree on whether `content.kind` can change for a live tab                                          | needs-investigation     | Settle whether a tab's content kind is immutable                                                                                                                   |
| `apps/web/src/features/workbench/components/file-editor-body.tsx:86`              | Same disagreement, for diff, history and compare-saved                                                                                                                                                                                                                                                                                                                                                                                                                                         | Same                                                                                                              | needs-investigation     | Same                                                                                                                                                               |
| `apps/web/src/features/workbench/components/editor-groups-layout.tsx:46`          | Every `EditorGroup` under a split node, including the siblings that did not change                                                                                                                                                                                                                                                                                                                                                                                                             | Splitting or unsplitting rebuilds editors in groups you never touched                                             | not-an-Activity-site    | Key on `node.id`; neutralise the library's per-panel-id-set layout cache                                                                                           |
| `apps/web/src/features/workbench/components/editor-group.tsx:66`                  | Only when the group empties; a tab switch reuses one controller and swaps the document                                                                                                                                                                                                                                                                                                                                                                                                         | Nothing on a tab switch; per-tab cursor and scroll come from the document store                                   | not-an-Activity-site    | The hidden branch cannot exist — `selectedTab` is null                                                                                                             |
| `apps/web/src/features/workbench/components/layout.tsx:67`                        | Whatever the active sidebar pane held, plus the remembered sidebar width                                                                                                                                                                                                                                                                                                                                                                                                                       | Toggling the sidebar resets tree scroll, the log stream and the chat draft                                        | not-an-Activity-site    | A collapse must give space back; drive the registered panel to zero size                                                                                           |
| `apps/web/src/features/chat-mode/components/layout.tsx:80`                        | Whichever tool is active, including the session terminal                                                                                                                                                                                                                                                                                                                                                                                                                                       | Collapsing the tool rail kills the session's shell after the TTL                                                  | not-an-Activity-site    | Same: unregistering the panel changes the layout-cache key; collapse rather than hide                                                                              |
| `apps/web/src/features/git/components/history.tsx:187`                            | The history subtree, reparented between inline and dialog positions                                                                                                                                                                                                                                                                                                                                                                                                                            | Expanding the graph rebuilds the list; scroll is restored from navigation state                                   | not-an-Activity-site    | Already inside the app's only `<Activity>`; the reparent is a layout change                                                                                        |
| `apps/web/src/features/chat-mode/components/stage-body.tsx:27`                    | Whatever was on the stage, when the project leaves `ready`                                                                                                                                                                                                                                                                                                                                                                                                                                     | A blip replaces a live conversation with an empty-state screen                                                    | not-an-Activity-site    | `!ready` means no project; the fall-through is a composer that cannot send                                                                                         |
| `apps/web/src/features/workbench/components/terminal-tabs.tsx:51`                 | Nothing. Every tab stays mounted; only visibility and interactivity change                                                                                                                                                                                                                                                                                                                                                                                                                     | Nothing, which is the point                                                                                       | leave-as-is             | The exemplar this plan copies at every visibility-inert site                                                                                                       |
| `apps/web/src/features/git/components/panel.tsx:113`                              | Nothing while it runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Changes ↔ Graph keeps both views' scroll and expansion                                                            | leave-as-is             | The only `<Activity>` in the repository, and the precedent this plan cites                                                                                         |
| `apps/web/src/features/git/components/panel.tsx:117`                              | The commit bar's DOM; the message lives in the git store                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing; a half-typed commit message survives                                                                     | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/git/components/history.tsx:98`                             | The commit details pane                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing; deselecting is a request to stop showing it                                                              | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/logs/components/panel.tsx:59`                              | The event list's scroll and listbox cursor, on a genuinely new filter key                                                                                                                                                                                                                                                                                                                                                                                                                      | A reset is the right answer when the filter changed                                                               | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/components/active-environment-application.tsx:25`                   | The entire application subtree, on a change of active environment origin                                                                                                                                                                                                                                                                                                                                                                                                                       | Switching machines rebuilds everything, which is what switching machines means                                    | leave-as-is             | Check the departing machine gets an explicit dispose rather than the TTL                                                                                           |
| `apps/web/src/features/workbench/components/code-panel.tsx:24`                    | Drag state and every editor group, on workspace root change                                                                                                                                                                                                                                                                                                                                                                                                                                    | Opening a different project rebuilds the editor area                                                              | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workbench/components/file-navigator-panel.tsx:46`          | The tree model, on root change                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | A fresh tree for a fresh project                                                                                  | leave-as-is             | Any registry must key on the same `rootPath`                                                                                                                       |
| `apps/web/src/features/workbench/components/terminal-tabs.tsx:28`                 | Nothing; the branch is reached only with zero tabs                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workbench/components/terminal-tabs.tsx:72`                 | The terminal list's listbox cursor; width is persisted                                                                                                                                                                                                                                                                                                                                                                                                                                         | Keyboard focus returns to the active tab                                                                          | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workbench/components/editor-group.tsx:58`                  | The breadcrumb bar's popover key and expansion, per file                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing; the symbol query keeps previous data                                                                     | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workbench/components/diagnostics-panel.tsx:128`            | Nothing beyond a list with no rows                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing, and it branches pending before empty                                                                     | leave-as-is             | A positive example for the fall-through rule                                                                                                                       |
| `apps/web/src/components/app-workspace.tsx:41`                                    | Nothing; it runs before a workspace exists                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/components/app-workspace.tsx:53`                                    | Everything under `WorkspaceView`, when the root folder is cleared                                                                                                                                                                                                                                                                                                                                                                                                                              | Closing a workspace tears the IDE down, as intended                                                               | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/components/app-workspace.tsx:60`                                    | The project picker's browsing position                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Reopening starts fresh                                                                                            | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/components/application-bootstrap.tsx:76`                            | Nothing; both gates precede the provider stack                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing                                                                                                           | leave-as-is             | The runtime is effect-owned here, so a remount rebuilds it                                                                                                         |
| `apps/web/src/components/command-palette.tsx:6`                                   | The prompt, results, selection, and four live previews                                                                                                                                                                                                                                                                                                                                                                                                                                         | Closing gives a clean prompt, and the preview rollback is why it must unmount                                     | leave-as-is             | The counterexample: a cleanup that is a rollback                                                                                                                   |
| `apps/web/src/features/command-palette/components/content.tsx:344`                | The cmdk root per mode change: item registry, controlled value, filter                                                                                                                                                                                                                                                                                                                                                                                                                         | Nothing; a sub-picker should start fresh                                                                          | leave-as-is             | Load-bearing key, not an accident                                                                                                                                  |
| `apps/web/src/features/command-palette/components/groups-factory.tsx:56`          | The previous mode's group list                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing                                                                                                           | leave-as-is             | A render switch under a deliberately keyed parent                                                                                                                  |
| `apps/web/src/features/workbench/components/move-tab-to-group-dialog.tsx:51`      | Nothing worth keeping; the content derives from the group tree                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workbench/components/breadcrumb-item.tsx:42`               | The picker's expansion set and active row                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Reopening starts at the current path                                                                              | leave-as-is             | Mounting the popover is what issues the directory request                                                                                                          |
| `apps/web/src/features/workbench/components/breadcrumb-folder-picker.tsx:78`      | Nothing; the popover was just opened                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing, and it branches pending before empty                                                                     | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workbench/components/wallpaper.tsx:13`                     | The decoded image or the playing video, and its blob URL                                                                                                                                                                                                                                                                                                                                                                                                                                       | Changing wallpaper swaps the image                                                                                | leave-as-is             | An idle wallpaper video is the largest idle GPU cost in the app                                                                                                    |
| `apps/web/src/features/workbench/components/web-wallpaper.tsx:70`                 | The video element and its decode pipeline                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing; the still image carries the look                                                                         | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workbench/components/editor-tab-bar.tsx:58`                | Nothing. Representative of fifteen stateless affordance swaps: `editor-tab-insertion.tsx:14`, `editor-group-drop-overlay.tsx:19`, `editor-drag-preview.tsx:21`, `tab-trailing-slot.tsx:53`, `app-titlebar.tsx:36`, `ui-mode-toggle.tsx:26`, `tree-header-detail.tsx:12`, `navigation-status.tsx:8`, `symbol-kind-icon.tsx:27`, `breadcrumb-folder-rows.tsx:42`, `breadcrumb-picker-row.tsx:51`, `action-dialog-content.tsx:43`, `machine-form.tsx:44`, `file-picker-dialog.tsx:523` and `:603` | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/chat-mode/components/stage-body.tsx:35`                    | The previous `ChatView`, when the session really is gone                                                                                                                                                                                                                                                                                                                                                                                                                                       | A "not found" screen, which is correct                                                                            | leave-as-is             | The transient-gap case belongs to `chat-view.tsx:126`                                                                                                              |
| `apps/web/src/features/chat-mode/components/stage-body.tsx:36`                    | The draft view on the draft → session transition                                                                                                                                                                                                                                                                                                                                                                                                                                               | The caret and the worktree radio pick; the text is in the draft store                                             | leave-as-is             | A deliberate identity change                                                                                                                                       |
| `apps/web/src/features/chat-mode/components/stage-header.tsx:87`                  | An uncontrolled rename input's typed value                                                                                                                                                                                                                                                                                                                                                                                                                                                     | The common path commits on blur, so the text is usually saved                                                     | leave-as-is             | A controlled value is the fix if certainty is wanted                                                                                                               |
| `apps/web/src/features/chat-mode/components/session-rail.tsx:371`                 | Nothing; the marked set is in a module store                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/chat-mode/providers/session-controller.tsx:107`            | Four dialogs' local state, only when chat mode exits                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing in normal use                                                                                             | leave-as-is             | Already hoisted above their triggers on purpose                                                                                                                    |
| `apps/web/src/features/chat/providers/pending-requests-provider.tsx:54`           | The in-flight approval response map                                                                                                                                                                                                                                                                                                                                                                                                                                                            | The Approve button stops showing its submitting state                                                             | leave-as-is             | A hand-rolled in-flight tracker where `useMutationState` is the house rule                                                                                         |
| `apps/web/src/features/chat/components/timeline-viewport.tsx:203`                 | The minimap's rail ref and focused mark                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Keyboard focus in the minimap, on a rare threshold crossing                                                       | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/chat/components/timeline-viewport.tsx:217`                 | Nothing of its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/chat/components/assistant-changed-files-tree.tsx:22`       | Per-directory expansion overrides inside an expanded card                                                                                                                                                                                                                                                                                                                                                                                                                                      | Scroll past overscan and the directories you opened snap back                                                     | leave-as-is             | A store move, not an `Activity` move                                                                                                                               |
| `apps/web/src/features/chat/components/user-message-body.tsx:13`                  | The "show more" state of a long prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                         | An expanded prompt collapses after scrolling past it                                                              | leave-as-is             | Same class                                                                                                                                                         |
| `apps/web/src/features/chat/components/proposed-plan-card.tsx:28`                 | The expanded body of a plan card                                                                                                                                                                                                                                                                                                                                                                                                                                                               | An expanded plan collapses when its row leaves overscan                                                           | leave-as-is             | Same class, and the one a user reads at length                                                                                                                     |
| `apps/web/src/features/chat/components/assistant-markdown-code-block.tsx:31`      | A per-block soft-wrap toggle                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A wrapped block un-wraps after scrolling away                                                                     | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/chat/components/assistant-markdown-mermaid.tsx:32`         | The rendered SVG, re-produced by an async render                                                                                                                                                                                                                                                                                                                                                                                                                                               | A diagram flashes its source before the SVG returns                                                               | leave-as-is             | A module-scope SVG cache would remove the cost                                                                                                                     |
| `apps/web/src/features/chat/components/model-picker.tsx:75`                       | An open picker, its query and provider scoping                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Rare; the picker closes on select                                                                                 | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/chat/providers/provider-sign-in-provider.tsx:28`           | An attempt id, which would orphan a running `claude auth login`                                                                                                                                                                                                                                                                                                                                                                                                                                | Nothing; it is mounted at the app root above every chat subtree                                                   | leave-as-is             | The model the rest of the feature should follow                                                                                                                    |
| `apps/web/src/features/chat/components/agents-panel.tsx:23`                       | Nothing of its own, but it renders inside the timeline viewport                                                                                                                                                                                                                                                                                                                                                                                                                                | An open dialog vanishes if the timeline empties                                                                   | leave-as-is             | Fix `timeline-viewport.tsx:152` instead                                                                                                                            |
| `apps/web/src/features/workspace/components/search-results.tsx:88`                | The results view and its pooled editors                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing; the branch means there are no results                                                                    | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/workspace/components/search-results.tsx:92`                | Nothing at runtime; `compact` is fixed per call site                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/search/components/result-file-editor-pool-slot.tsx:76`     | One pooled result editor, on eviction                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Barely; the pool retains one recently-hidden entry and hides the rest                                             | leave-as-is             | Prior art: an `Activity`-shaped pool implemented by hand, more precisely                                                                                           |
| `apps/web/src/features/settings/components/page.tsx:103`                          | The whole settings page, when the document query has no data                                                                                                                                                                                                                                                                                                                                                                                                                                   | Rarely; an owner switch retriggers it                                                                             | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/settings/components/page.tsx:234`                          | A filtered-out row's widget draft                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Type in search while a row below is mid-edit                                                                      | leave-as-is             | If drafts matter they belong in a store keyed by setting id                                                                                                        |
| `apps/web/src/features/settings/components/dialog.tsx:77`                         | The settings page and any half-typed provider config                                                                                                                                                                                                                                                                                                                                                                                                                                           | Deliberate, and the file says so in a comment                                                                     | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/settings/components/widgets/palette-editor.tsx:65`         | The palette draft, and the preview rollback on unmount                                                                                                                                                                                                                                                                                                                                                                                                                                         | Closing discards the draft, which is what Cancel means                                                            | leave-as-is             | The counterexample: hiding would revert the theme and keep the draft                                                                                               |
| `apps/web/src/features/environments/components/project-picker.tsx:31`             | The machine-choice step, replaced by the file picker                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing; it is a two-step wizard                                                                                  | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/environments/components/auth-dialog.tsx:6`                 | The auth form's field state per prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Nothing; credentials should not survive                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/editor/components/diff-editor.tsx:56`                      | Both diff panes and their editor controllers                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Almost nothing; scroll, regions and layout live in tab presentation                                               | leave-as-is             | The reference implementation of externalised state                                                                                                                 |
| `apps/web/src/features/editor/components/diff-editor.tsx:64`                      | One pane replaced by two, on a settings change                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Scroll survives; tokenizing is redone                                                                             | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/editor/components/history-view.tsx:22`                     | The `HistoryViewer`, refcounted on a `useSyncExternalStore` subscription                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing; focus and selection replay from tab presentation                                                         | leave-as-is             | Proof that a store source owning an instance is an effect-scoped resource                                                                                          |
| `apps/web/src/features/editor/hooks/use-diagnostic-peek.ts:41`                    | The peek source and its claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | An open peek closes on tab switch, as the sibling effect already intends                                          | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/editor/components/language-server-references-pane.tsx:128` | The row list when a result comes back empty                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The intended empty verdict                                                                                        | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/editor/components/editor.tsx:328`                          | The diagnostic peek's placement state and its `ResizeObserver`                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing; it re-measures on each open                                                                              | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/editor/components/editor.tsx:322`                          | A loader overlay with no state                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `apps/web/src/features/editor/components/frame.tsx:63`                            | The editor's right-click menu surface                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `packages/tree/src/components/FileTreeView.tsx:1304`                              | Nothing. The search container is permanently mounted and toggled with `data-open`                                                                                                                                                                                                                                                                                                                                                                                                              | Nothing, deliberately                                                                                             | leave-as-is             | The in-house precedent for attribute-toggling over unmounting                                                                                                      |
| `packages/tree/src/components/menu-trigger.tsx:60`                                | Nothing; only a data attribute flips                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing                                                                                                           | leave-as-is             | Second in-house precedent                                                                                                                                          |
| `packages/tree/src/components/FileTreeView.tsx:1330`                              | Sticky overlay rows, recomputed every scroll frame                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `packages/tree/src/components/FileTreeView.tsx:1441`                              | The context menu surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing                                                                                                           | leave-as-is             | —                                                                                                                                                                  |
| `packages/ui/src/components/loading-state.tsx:37`                                 | The skeleton preview only, behind the 120 ms delay                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing                                                                                                           | leave-as-is             | Changing it would defeat the anti-flash rule                                                                                                                       |
| `packages/ui/src/patterns/virtual-list.tsx:152`                                   | Off-window rows and any per-row state                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Row state resets on scroll-away, which is why 24 files use `memo()`                                               | leave-as-is             | Windowing is the point; `Activity` cannot help                                                                                                                     |
| `packages/ui/src/components/popover.tsx:24`                                       | The portal's content subtree on close, across popover, dialog, menu, select, tooltip                                                                                                                                                                                                                                                                                                                                                                                                           | Filter text and scroll inside a popover are gone on close                                                         | leave-as-is             | The fix is per-consumer `keepMounted`, never a blanket primitive change                                                                                            |
| `packages/ui/src/components/resizable.tsx:59`                                     | Nothing; the library keeps children mounted at any size                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing                                                                                                           | leave-as-is             | The escape hatch for both collapse ternaries                                                                                                                       |
| `packages/markdown/src/components/markdown.tsx:63`                                | A block's subtree when it leaves the list                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing; a WeakMap keyed on the block object preserves element identity                                           | leave-as-is             | —                                                                                                                                                                  |

### The `ToolPane` row, stated exactly

`packages/ui/src/patterns/tool-pane.tsx:40` replaces `children` with a loading, error or empty node
whenever `state.pending`, `state.error` or `state.empty` is set. Two of eleven consumers pass `state`
at all — `features/git/components/panel.tsx:69` and `features/logs/components/panel.tsx:61`, both
with `isPending` — so there is no prior state to lose today in the other nine. This is not "every
pane in the IDE loses scroll on refetch".

The live consequence is narrow and worth fixing on its own: the git panel's `<Activity>` pair at
`panel.tsx:113` and `:116` is `children` of that same `ToolPane`, so **the app's only working
`Activity` boundary is discarded whenever `status.isPending` flips**. Changes ↔ Graph keeps both
views' scroll, and a background refetch throws both away. The fix belongs at the call site — render
the loader as an overlay over a retained body — because a primitive cannot know what `children`
holds.

### What this plan changes

Five sites, chosen because each either stops a data-loss bug or teaches the pattern at zero risk, and
because none needs a cross-package refactor first. Everything else above is correct as written or
waits behind a prerequisite this plan scopes but does not spend.

## Phase A1 — the chat-mode surface stops killing the terminal

The workbench bottom panel is not here. `bottom-panel.tsx:65` and `workbench/components/layout.tsx:96`
are ranks 1 and 2 of [Plan 127](127-compiler-and-lifetime-repairs.md) Phase 3, which owns the repair
and has already applied rank 1; this phase must not re-land either. What 127 leaves ranked and
unrepaired is the chat-mode half of the same defect plus the unreachable-machine branch, and that is
what this phase takes.

Three sites, one pass. The first two nest the way the workbench pair does — collapsing the tool rail
and picking another tool both reach the one `TerminalPanel` behind them, so fixing either alone
leaves the shell reachable through the other. The third is the unreachable-machine branch inside that
same panel.

1. `chat-mode/components/tool-pane.tsx:82` stops being the fall-through of a seven-way `if` chain and
   becomes a mounted set stacked at the call site, in the shape `terminal-tabs.tsx:51-56` already
   uses: each layer `absolute inset-0`, the inactive one carrying `invisible` and `inert`. Its
   `active` prop becomes `tab === 'terminal'` rather than the hardcoded `active` it passes at `:88`.
   A permanently mounted terminal that still claims the command inbox and a focus target is a second
   defect introduced by the first fix. `<DiagnosticsPanel />` at `:74` takes the `enabled` prop
   127 already added.
2. `chat-mode/components/layout.tsx:80` stops removing the `ResizablePanel`. The panel becomes
   `collapsible` with `collapsedSize={0}`, present in `react-resizable-panels@4.12.4`, driven from
   `panels.toolPaneOpen`. Collapsing must still return the space, so this is a size change. It is
   also why removal is wrong beyond the unmount: unregistering the panel changes the key of
   `mutableState.layouts`, so the remembered sizes for that panel set are not the ones read back.
   Plan 127's rank-2 measurement check applies here too — confirm the host comes back with a non-zero
   box and refits before calling it done.
3. `terminal/components/panel.tsx:296` renders the unreachable-machine notice as an overlay over the
   retained host, in the shape `:330-343` already uses for loading, so a reconnect reattaches instead
   of rebuilding. Plan 127 ranks this sixth and rules it out of its own repair, correctly: when the
   machine is unreachable the socket is already gone and the server's detach timer runs on its own
   clock, so retaining the host saves no shell. It is here for the other reason — a reconnect that
   reattaches to a live ghostty instance does not rebuild the grid or replay the scrollback — and
   that reason has to be stated, because "it keeps the shell alive" would be false.

Fixing `workspace/components/view.tsx:22` the same way is the obvious next step and is deliberately
not in this phase: it keeps both entire surfaces mounted from startup, and the cost of that has never
been measured.

Verify: add `scripts/agent/scenarios/terminal-panel-swap.ts` with its selectors in
`scripts/agent/selectors.ts` and a paragraph in `.agents/skills/verify-fregat/features/terminal.md`.
It opens a chat-mode session terminal, writes a marker line, picks **Git**, returns to **Terminal**,
and asserts the marker is still in the scrollback and the session id did not change; it then repeats
the round-trip by collapsing and reopening the tool rail. Merge `scenarios/index.ts` and
`selectors.ts` rather than overwriting; both are dirty, and Plan 127 Phase 3 adds
`bottom-panel-persistence` to the same two files. Then
`bun run agent:browser scenario terminal-panel-swap`, read the screenshot back, and
`bun run agent:browser look --selector <tool pane>` at both tabs to confirm the hidden layer costs
no width. The server-side failure is a ten-minute timer, so no unit test can stand in for this.

Completion: switching the chat tool pane away from Terminal, collapsing the tool rail, and losing the
machine all keep the session's ghostty host mounted, with the scenario green and its evidence
directory named.

## Phase A2 — the one clean win, and the one beside it

The logs pane is the shape every other candidate should be measured against, because the seam it
needs already exists and is currently inert:

```tsx
<Activity mode={tab === 'logs' ? 'visible' : 'hidden'}>
  <LogsPanel active={tab === 'logs'} />
</Activity>
```

`LogsPanel` takes `active: boolean` at `features/logs/components/panel.tsx:28` and threads it into
`useLogLive`, `useLogEvents` and both `useLogSummary` calls at `:41-44`. Both call sites —
`chat-mode/components/tool-pane.tsx:66` and `workbench/components/sidebar-panel.tsx:91` — pass a
hardcoded `active`, so the prop does nothing today. A pane that already gates its own subscriptions
on a prop is a pane whose author has done the hard half of the work.

The stream tearing down while hidden is correct, not a loss: `logsKeys` has no consumer outside the
feature, and the reveal refetch returns the full server-side window. Do not build a refcounted module
subscription; it would hold an SSE connection open for a pane nobody is looking at, and a refcount
acquired in an effect is released by `Activity` anyway.

The second site is `settings/components/raw-conflict-banner.tsx:99`, which becomes
`<Activity mode={compareOpen ? 'visible' : 'hidden'}>`. Two `<pre>` blocks over strings already in
hand: no resource, no measurement, no portal, no virtualizer. It belongs here because a pattern with
no cheap example does not get copied.

`settings/components/widgets/wallpaper-widget.tsx:35` is the third candidate and is held back one
step: the picker is a Base UI dialog, and Base UI's portal unmounts its content at `open={false}`,
which makes `Activity` a DOM no-op whose only effect is suppressing effects. Confirm the portal's
`keepMounted` state before converting it; if the dialog ever gains `keepMounted`, its virtualizer
meets `display: none` and the site leaves the safe bucket.

Verify: `bun --bun vitest run --project dom src/features/logs/tests --cwd apps/web`, then
`bun run agent:browser scenario logs-search-no-flicker` and a `look` at the settings conflict banner
with compare hidden and shown.

Completion: leaving the Logs tab stops the tail and returning refetches without a gap; hiding and
re-showing the conflict comparison keeps both scroll positions; both `LogsPanel` call sites read
`active={tab === 'logs'}` instead of `active`.

## Phase A3 — prerequisite: the file tree's lifetime

The sidebar's Files branch is the highest-frequency unmount in the app and cannot be hidden until
`packages/tree` changes. The census named one teardown; there are two, and neither is what the fix
was described as.

1. `useFileTree.ts:19` creates the model in a `useState` initialiser, which `Activity` **preserves**,
   while `:61-64` schedules `model.cleanUp()` on a 1 ms timer from the effect cleanup. `cleanUp()`
   reaches `FileTreeController.destroy()`, which drops `#unsubscribe` with no re-subscribe path. So
   hiding hands the same, permanently dead instance back on reveal — strictly worse than today's
   unmount. Moving construction into a registry is a no-op, because construction was never in the
   effect: **disposal** is what has to leave it.
2. `FileTree.tsx:175-180` is a second, earlier teardown: a layout effect whose cleanup calls
   `model.unmount()`, destroying the inner `createRoot` root inside the shadow host and everything
   `FileTreeView` holds. It fires on every hide regardless of the timer.

The change is in the package, not the app: split `unmount()` (detach the DOM, reversible) from
`destroy()` (drop subscriptions, irreversible), make `render()` after `unmount()` re-establish a
working view, and give instance ownership to a module registry keyed by `rootPath` with eviction —
`toolRoot` is per-session, so an unbounded registry accumulates one live controller per session. The
1 ms StrictMode timer is deleted in the same pass.

This phase lands the package change and stops there. It does not convert `sidebar-panel.tsx:89`,
because the tree's shadow-root virtualizer measures itself and the sidebar still has to prove it
comes back from `display: none` — and if it does not, that branch is visibility-and-inert rather than
`Activity`, which changes the whole shape of the sidebar's answer.

Verify: `bun x --no-install vitest run src/tests --cwd packages/tree`, then a hide/show drive
asserting the controller is still subscribed and the expansion set survives.
`bun run agent:browser scenario tree-sticky-scroll` before and after the change.

Completion: a `FileTree` model survives a detach and reattach with its subscription intact; no
`setTimeout(…, 1)` remains in `useFileTree`.

## Phase A4 — prerequisite: the `VirtualList` Activity contract

Every list-bearing pane in the activity-after-refactor bucket is blocked on the same two facts, and
neither belongs to the pane.

1. **Zero-size measurement.** `VirtualList` with `measureItems` gives every row
   `virtualizer.measureElement` at `virtual-list.tsx:157`, whose per-row `ResizeObserver` callback in
   `@tanstack/virtual-core@3.17.0` guards only on `node.isConnected` — still true under `Activity`,
   which keeps the DOM. A 0 `blockSize` can therefore be written into the size cache and `resizeItem`
   adjusts scroll on the delta. Whether it does depends on React's commit ordering between the
   `display:none` mutation and the layout-effect teardown that disconnects the observer, which is a
   guarantee this repository should assert rather than assume. Give `VirtualList` a `measureElement`
   that returns the cached size when the observed box is 0.
2. **Scroll ownership.** `display: none` destroys the scroll box and React restores nothing.
   `features/git/components/history-list.tsx` already solves this with `initialOffset` plus an
   `onScrollEnd` write into navigation state, and that — not "queries only" — is the real reason the
   git `<Activity>` pair works. Adopt the same contract in `VirtualList` so a consumer can hand it an
   offset it owns.

Verify: a browser test under `packages/ui/src/patterns/tests/` that hides a populated `VirtualList`
inside an `<Activity mode="hidden">`, reveals it, and asserts no cached row height became 0 and the
offset was restored. That test is the contract; without it the first React upgrade that changes
commit ordering breaks four panes silently.

Completion: a hidden `VirtualList` returns with its measurement cache and its offset intact, proven
by that test, and `messages-timeline.tsx` and `event-list.tsx` are named as the first two consumers
to adopt the offset contract.

## Phase A5 — prerequisite: the editor's lifetime, and why it is deferred

Stated so nobody rediscovers it, and explicitly not scheduled here.

`packages/editor-react/src/index.ts:219` and `:230` both dispose from effect cleanup, so the editor
cannot be hidden. Three facts make this larger than a lifetime seam. `scheduleReactDispose()` calls
`suspendEditor()` synchronously before its microtask, writing empty snapshot fields into the store,
so every `useEditorSelector` consumer in the hidden subtree observes `editor: null` at hide time,
before any dispose runs — the store's render-phase `refreshSubscription` then publishes that
emptiness on the same commit. The controller is constructed in-component in a `useRef`, so a registry
that owns lifetime must own construction, which is a breaking change to `useEditor` and `EditorHost`
— exported API of `@singapore-editor/react` in the separate `/work/projects/Editor` checkout, with
three call sites here. And the editor measures continuously: `fixedRowVirtualizer` drives the
viewport from a `ResizeObserver`, `browserMetrics` reads a font probe whose zero-geometry fallback is
guarded for the shared cache but still returned to the caller, and `Editor.ts`'s appearance
`MutationObserver` watches the `style` attribute of every ancestor — the attribute `Activity` itself
writes.

Even granting all of it, there is no hidden-tab subtree to wrap: `editor-group.tsx:30` picks one
`selectedTab` and renders one body, and a tab switch already reuses one controller and swaps the
document. The `Activity` target would be a per-tab fan-out that does not exist yet, and each retained
editor costs a minimap worker, two transferred `OffscreenCanvas`es and a live LSP `didOpen`, which
would have to fold into the existing byte-budgeted `editorRetention` policy rather than sit beside
it.

Completion: this scope is recorded and closed. If an editor `Activity` site is ever wanted, it starts
from the fan-out and the retention budget, not from the dispose schedule.

## B. Fragment Refs

A `ref` on a `<Fragment>` yields a `FragmentInstance` over the fragment's host children:
`addEventListener`, `removeEventListener`, `dispatchEvent`, `focus`, `focusLast`, `blur`,
`observeUsing`, `unobserveUsing`, `getClientRects`, `getRootNode` and `scrollIntoView`. It is live
and typed in this build — `@types/react/index.d.ts:739` declares `FragmentInstance` and
`@types/react-dom/index.d.ts:30-37` fills it in. There are zero uses in the repository.

This is a section, not a project. The census found 23 candidates and 5 worth doing: two focus sites
and three `observeUsing` sites. The repository holds 34 `.focus()` call sites, 3 places where a child
climbs to an ancestor, and **zero** `IntersectionObserver` uses — so the observer half of the pattern
has one shape here, not many.

It earns its place in exactly two situations: addressing a group of children a component renders but
does not wrap, and attaching an observer across a changing child set without a wrapper element whose
own box changes what is being measured. It is not a handle for reaching into a child's DOM, and
`focus()` addresses a position ("first focusable in here"), never a named control.

**The constraint that bounds every candidate:** `scripts/agent/selectors.ts` addresses the DOM by
attribute. `data-editor-tab-id`, `data-index`, `data-editor-group-id` (ten places),
`data-tool-group-scroll` and `data-breadcrumb-item` are all load-bearing for scenarios. A wrapper
deleted in the name of this pattern that takes a selector with it is a regression, not a cleanup.
Every candidate below keeps its attributed elements.

### Phase B1 — two focus sites and the helper that makes them a pattern

| Site                                                                         | Today                                                                        | After                                                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/workbench/components/move-tab-to-group-dialog.tsx:31` | `element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()` | A `Fragment` ref over the group button list, `choicesRef.current?.focus()`                                |
| `apps/web/src/features/editor/components/diagnostic-peek.tsx:34`             | `element.querySelector<HTMLElement>('button')?.focus()`                      | A `Fragment` ref over the peek surface's three children, `contentRef.current?.focus()`                    |
| `apps/web/src/lib/focus/utils/group-intent.ts`                               | —                                                                            | New: `focusGroupIntent(group, element)` calls `focus()` and returns whether focus landed inside `element` |

The move-tab dialog is the strongest of the set because its selector is not merely verbose, it is
wrong in a way that is waiting to fire. `:not(:disabled)` encodes "enabled" as an attribute test, but
28 `Button` call sites in this repository pass `focusableWhenDisabled`, which makes Base UI render
`aria-disabled` with no `disabled` attribute. The day a group button adopts that flag, the selector
matches it, `.focus()` is a no-op, `onIntent` still returns `true`, and the dialog opens with nothing
focused while the focus service believes the transition was accepted. `FragmentInstance.focus()`
cannot fail that way: it listens for the capture-phase focus event and moves to the next child when
focus did not land. It also stops encoding "the choices" as the tag name `button`, so
`DialogContent`'s own trailing close button stays out of reach by construction rather than by DOM
order.

The diagnostic peek is the same shape with a different smell: `querySelector('button')` means
"whatever button comes first", which today resolves to Close. The related-information rows are
`Button`s now and the obvious next step is an `<a>`, at which point the selector silently keeps
skipping them.

`group-intent.ts` exists because `FragmentInstance.focus()` returns `void` while `onIntent` must
return whether it accepted. An implementer who forgets that writes `group.focus(); return true`,
which is the exact false-acceptance bug the two rewrites are removing. It qualifies for `lib/` on the
two-consumer rule, it is pure and React-free so `utils/` is the right kind directory, and it imports
nothing from `@/features/*`.

Verify: `bun --bun vitest run --project dom src/lib/focus/tests --cwd apps/web`, plus a focus-intent
test per dialog asserting focus landed on the first enabled choice with a `focusableWhenDisabled`
button present.

### Phase B2 — the observer sites

| Site                                                            | Today                                                                                                                           | After                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/workbench/state/tab-strip-metrics.ts:91` | A `ResizeObserver` plus a `MutationObserver` with `subtree: true`, whose only job is noticing the observe loop needs re-running | `observeUsing` from a `Fragment` ref around the tab map in `editor-tab-bar.tsx`; the `MutationObserver` and the `observed` bookkeeping are deleted |
| `apps/web/src/features/chat/state/work-log-scroll.ts:21`        | The same pair, with `characterData: true, subtree: true` on the group container                                                 | `observeUsing` over the rows in `activity-group-row.tsx` and `live-activity-row.tsx`; the container `ResizeObserver` stays                         |

Both are the textbook case: an observer attached in a loop over children, plus a `MutationObserver`
that exists only to notice the loop needs re-running — which is the job React does for free when the
observer is attached to a fragment.

Both are also defects, not just verbosity. The tab strip's subtree `MutationObserver` fires on any
descendant mutation, so a dirty dot toggling or a spinner mounting inside one tab triggers a full
`readLayout` with a synchronous `getBoundingClientRect` per tab — the file's own header comment says
it was written to stop that class of forced layout. The work log's is hotter: `subtree` plus
`characterData` on a group whose expanded rows render streamed tool output means a forced layout per
streamed token, on the surface where streaming is constant.

Two things do not change. `readLayout` keeps its `querySelectorAll`, because `getClientRects()`
returns a flat rect array with no identity and the offsets map is keyed by tab id. And
`activity-detail-section.tsx:17` keeps the full `MutationObserver` path: React refuses `observeUsing`
on a `FragmentInstance` whose only child is text, and a `ResizeObserver` on a `<pre>` already at its
`max-h-64` cap sees no box change when text is appended, so `characterData` is the only signal that
the scroll boundary moved. That is the honest counterexample, and the reason the work-log change is
two call sites rather than three.

The tab-strip change has a real cost: the controller is constructed from the strip element today, so
it has to become constructible before its element, with the element attached in the existing layout
effect. That is a restructure, not a swap.

Verify: `bun run agent:browser trace editor-split-order --compare <baseline>` for the tab strip and
`bun run agent:browser trace chat-stream --compare <baseline>` for the work log, adding `chat-stream`
if it does not exist. Capture the baseline first; none exists today. The claim is fewer forced
layouts; if the difference is inside the run-to-run spread, the report says the observers are
narrower and the frame time did not move.

### Considered and rejected

Recorded so nobody proposes them again.

| Site                                                                                                                                                                                | Why not                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `features/command-palette/components/content.tsx:144`                                                                                                                               | `data-slot` is a deliberate design-system contract, selected on for styling in the same file. Identical behaviour, and the current form returns `false` when the input is missing so the service can route elsewhere                                                     |
| `features/editor/components/history-pane.tsx:113`                                                                                                                                   | The existing code names what it wants; a fragment would name a position in a subheader that is explicitly ordered. The `return false` guard is load-bearing — the graph can be absent                                                                                    |
| `packages/ui/src/components/input-group.tsx:59`                                                                                                                                     | An outright regression. An `align='inline-start'` addon is first in DOM, so `focus()` would hit the colour swatch instead of the hex field. The real fix is one selector: `[data-slot="input-group-control"]`, which also covers the textarea the current one cannot see |
| `features/chat/components/timeline-minimap.tsx:48`                                                                                                                                  | Index-addressed roving. `FragmentInstance` offers `focus` and `focusLast` and nothing between                                                                                                                                                                            |
| `features/workbench/components/breadcrumbs-bar.tsx:40` and `:49`                                                                                                                    | Steps relative to `document.activeElement`; needs the ordered collection. The container is also the nav landmark a selector matches by role and name                                                                                                                     |
| `features/search/components/results-view.tsx:85`                                                                                                                                    | F2 must reach one named action inside a row, not the first focusable. The row is reached through `getElementById` inside a `VirtualList`, so there is no stable fragment to hold                                                                                         |
| `features/settings/components/dialog.tsx:39`                                                                                                                                        | `focus()` would land on a view-toggle button, because `PageHeader` renders before the search bar. `SettingsPage` already owns `searchRef`; the fix is a narrow action across the boundary                                                                                |
| `features/workbench/components/terminal-list-row.tsx:55`                                                                                                                            | A child reaching an ancestor, which a `FragmentInstance` can never serve — it addresses children. The list already holds the tablist ref; pass a callback                                                                                                                |
| `components/focusable-panel.tsx:17`, `components/app-shell.tsx:20`, `features/editor/components/tab-placeholder.tsx:18`, `features/editor/components/unsaved-changes-dialog.tsx:53` | These focus the registered container itself, a `tabIndex={-1}` host that is deliberately the focus stop. A fragment has no host node to focus                                                                                                                            |
| `packages/tree/src/hooks/use-context-menu.ts:198`                                                                                                                                   | Not DOM focus. `item` is a controller item, and controller focus is deliberately scroll-neutral                                                                                                                                                                          |
| `packages/ui/src/patterns/use-listbox.ts:116`                                                                                                                                       | `getClientRects()` collects a rect per child, so computing a page size from one row would force layout on the whole window. The container is the single tab stop and cannot go                                                                                           |
| `packages/ui/src/patterns/use-row-height.ts:8`                                                                                                                                      | The probe resolves a CSS variable before any row exists. Measuring real children to decide which children to render is circular                                                                                                                                          |
| `features/editor/components/diagnostic-peek.tsx:79`                                                                                                                                 | The wrapper carries layout: `absolute inset-0 z-30` is the containing block whose rect is fed to the placement helper                                                                                                                                                    |
| `packages/ui/src/patterns/virtual-list.tsx:154`                                                                                                                                     | The wrapper carries the transform or margin that positions the row, and `data-index` backs a timeline selector                                                                                                                                                           |
| `lib/documents/state/group-geometry.ts:7`                                                                                                                                           | Addressed by id from outside the tree that owns it. A module `Map` populated by each group's own ref is the fix; `data-editor-group-id` is in ten selectors and stays                                                                                                    |
| `features/chat/state/timeline-navigation.ts:70`                                                                                                                                     | Real delegation, but on the scroll container itself, whose identity a handler tests against `event.target`                                                                                                                                                               |

## C. The sync-lane constraint

`useSyncExternalStore` schedules on `SyncLane` unconditionally. Its change path is
`forceStoreRerender` → `enqueueConcurrentRenderForLane(fiber, 2)` → `scheduleUpdateOnFiber(root,
fiber, 2)`, read at `apps/web/node_modules/react-dom/cjs/react-dom-client.development.js:8642`. Lane
2 is sync. There is no priority argument and no way to lower it.

**The constraint is about which state sits behind the hook, not how many hooks there are.** In this
app that state is focus, the command bus, the editor runtime, navigation, the workspace panel layout
and the chat projection — the surfaces you would most want to schedule. Every one of them changes
inside an uninterruptible synchronous render, and 43 app files import zustand, whose `useStore`
reaches React through the same function.

**So `startTransition` and `useDeferredValue` around a store write do nothing here.** Wrapping a
store setter in a transition, or deferring a value that came out of `useSyncExternalStore`, is code
that reads like a performance fix and is inert. This is the single most important constraint on
render work in this repository, and it is the one that costs a week if nobody writes it down.

Deferral still works when the update starts as React state: a `useState` setter, a suspending read,
or a route change — TanStack Router already wraps every navigation in `React.startTransition` through
its `Transitioner`. The test is which hook produced the update, not how expensive the render is.

The codebase contains the correct workaround and its own explanation.
`apps/web/src/features/settings/hooks/use-transitioned-color-mode.ts` re-publishes a store-driven
colour mode as component `useState` and transitions _that_ setter, with the comment "Settings
subscriptions are synchronous; give React ownership of the visual commit." That is the whole pattern:
if a store-driven change must be interruptible, republish it as local state at one boundary and
transition the republication. It is the only `startTransition` in the app, and it is in the right
place.

| Deferral works                                                                                                                                          | Deferral cannot work                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `features/settings/hooks/use-transitioned-color-mode.ts` — a store value republished as `useState`, then transitioned                                   | Anything driven by `useEditorUiState`, `useEditorDocumentState`, `useEditorWorkspaceState` or `useEditorConflictState` |
| Route changes, already wrapped by TanStack Router                                                                                                       | The session rail, the chat projection and the session-selection stores                                                 |
| A suspending read behind a boundary                                                                                                                     | The workspace panel store behind every pane layout                                                                     |
| A local filter or query input feeding a large synchronous render — the search field, the palette prompt, the logs filter box, before they reach a store | The file-tree controller's subscription, the git store, the settings mirror                                            |

When a store-driven render is too slow, the answers are fewer subscribers, a narrower selector, or
less work per row. Scheduling is not one of them.

### The count, and what it is not evidence of

Measured at `b915d3e0` with tests, browser tests and `node_modules` excluded:

| Root                                                             | Files | Calls |
| ---------------------------------------------------------------- | ----: | ----: |
| `apps/web/src`                                                   |    29 |    31 |
| `apps/tui/src`                                                   |    29 |    67 |
| `packages/tree`, `packages/client-core`, `packages/editor-react` |     4 |     7 |

An earlier count of "~71 production sites" was inflated: it swept in tests and the linked Editor
`dist`. The corrected numbers retire the selector-granularity worry the audit raised. Of the 31 calls
in `apps/web/src`, **two** subscribe to a whole store with a bare `getState`; the rest pass either
zustand's own `useStore(store, selector)` — `features/git/state/store.tsx:29`,
`lib/environments/state/store.ts:19`, `features/chat/hooks/use-optimistic-messages.ts:18`,
`features/chat-mode/hooks/use-session-list-row.ts:10` and others — or a purpose-built snapshot
function on a service object. Selector granularity is not the problem.

`apps/tui` is a different app and its 67 calls are the textbook correct use: it bridges OpenTUI's
renderer event emitter, as in `useSyncExternalStore((notify) => { renderer.on('capabilities',
notify) … })`. It is not a smell and this plan does not touch it.

Roughly one bridge per external system is the right number for an IDE. Most state here is written
from outside React — the command bus, the PTY, the orchestration socket, the editor runtime,
`FocusService`, the navigation coordinator — and each needs exactly one hook to reach React. Leave
the other 28 alone.

### Phase C1 — the three hand-rolled stores

The actionable item is small and specific. Three stores implement their own subscribe/snapshot
plumbing rather than building on `createStore` from `zustand/vanilla`, which ten modules in
`apps/web/src` already use:

| Store                                                | Current behaviour                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/logs/state/filter-store.ts`   | Module-level `let filters`, `createSubscriptions()`, and a hand-written `defaultsSnapshot` cache with a `sameFilters` field-by-field comparison at `:41-50` |
| `apps/web/src/features/settings/state/view-store.ts` | Module-level `let view`, `createSubscriptions()`, a `settingsView()` snapshot reader                                                                        |
| `apps/web/src/state/navigation-coordinator.ts`       | A closure holding `listeners = new Set<() => void>()` at `:133`, `publish()` at `:149`, and `getSnapshot`/`subscribe` on the returned object at `:605-611`  |

`filter-store.ts` is the one that proves the point. Its own comment at `:23-27` records the trap it
already fell into:

```ts
/**
 * The defaults are re-derived but the OBJECT is reused while it is unchanged.
 * `useSyncExternalStore` compares snapshots by identity: returning a fresh object each
 * call is an infinite render loop.
 */
```

That footgun is re-armed by every hand-rolled store, and the next author writes the loop rather than
the cache. `zustand/vanilla` and `packages/utils/src/subscriptions.ts` already solve it. Open all
three and confirm the current shape before changing anything; `navigation-coordinator.ts` keeps its
imperative API and its operation logic, and only the subscription and snapshot plumbing moves.

This phase changes no scheduling behaviour and claims no performance gain. The sync-lane constraint
above is independent of it and stands whatever these three stores are built on.

Verify: `bun --bun vitest run --project dom src/features/logs/tests src/features/settings/tests --cwd
apps/web` and `bun run --cwd apps/web typecheck`. The failure a test here catches is a snapshot that
changes identity without changing value.

## D. The enforcement layer

Three patterns, three answers to "what fails when this is broken". Saying which is which is the point
of the section.

### Nothing here can be gated by tooling

The only automatable React-semantics measure in this area is the compiler census, and it belongs to
[Plan 127](127-compiler-and-lifetime-repairs.md). Each of this plan's three patterns was checked for
a gate and each failed for its own reason:

- **The resource rule.** The subtree is a component reference; the resource is three or four module
  hops away, sometimes in another package or another repository; deciding whether a cleanup releases
  something that matters requires reading it. A static rule would have to resolve the import graph
  into `packages/tree` and `@singapore-editor/react` and would be wrong in both directions. A rule
  that is quiet when it should fire is worse than no rule, because it gets trusted.
- **A `paneSwap` census** — flagging `{a ? <X /> : <Y />}` where neither branch is an icon or a loader
  — was drafted and rejected. It can only tell a pane swap from an icon swap by a shape test on
  branch names, which is a name test wearing a semantics test's clothes, and it is blind to
  `{open ? <Panel /> : null}`. `layout.tsx:96` is exactly that spelling and exactly the same defect,
  so the gate would sit green over the site next door to the one it caught, and teach that the class
  is covered.
- **The sync lane.** A rule flagging `startTransition` around a store setter cannot follow the setter
  through the callback it is usually behind. The false-negative rate would teach people the rule
  covers a case it does not.
- **Fragment Refs.** "Should have used a fragment ref" is not a detectable shape. A wrapper `<div>`
  that exists only to be measured looks exactly like a wrapper `<div>` that carries layout, and the
  difference is whether its box changes what is measured.

So these rules are enforced by reading, and this plan says so plainly rather than shipping a measure
that implies otherwise.

### The `AGENTS.md` prose

`CLAUDE.md` is a symlink to `AGENTS.md`; the text goes in the shared file. Each rule names an
exemplar that already exists, the way the truncation section names
`features/git/components/file-row.tsx`. Patterns spread from a named exemplar better than from a
rule.

A new section, after `## React Code`:

```markdown
## Hiding A Pane Without Killing What It Owns

- A resource that must outlive a render belongs in a module registry, not in an effect cleanup.
  `features/chat/state/active-transports.ts` holds chat's transports and `state/application-runtime.ts`
  holds the editor runtime; both survive any amount of mounting and unmounting because neither is owned
  by a component. An effect may attach a view to an already-owned resource. An effect that _creates_ the
  resource has made every future render decision a lifetime decision.
- `<Activity mode="hidden">` preserves `useState` and destroys effects. That is the whole rule: a subtree
  may be hidden with `Activity` only when nothing it owns lives in an effect's cleanup. The exemplar is
  `features/logs/components/panel.tsx`, which takes an `active` prop and gates every subscription on it,
  so hiding it stops the stream and revealing it refetches. The terminal
  (`features/terminal/components/panel.tsx`), the file-tree controller
  (`packages/tree/src/hooks/useFileTree.ts`) and anything holding an editor through `scheduleReactDispose`
  may not be hidden — their cleanup is the release, and hiding runs it.
- A hidden `Activity` also sets `display: none !important`, which destroys the subtree's layout boxes.
  Two things follow. A scroll container loses `scrollTop` and React never restores it, so an offset that
  must survive is held outside the DOM — `features/git/components/history-list.tsx` is the reference,
  with `initialOffset` in and `onScrollEnd` out. And a pane that must keep a real box while hidden stays
  mounted behind `visibility` and `inert`, stacked in one positioned container:
  `features/workbench/components/terminal-tabs.tsx` is the reference, and the terminal is that shape
  permanently. There is no shared primitive for this, because safety under `display: none` is a property
  of the children, not of the wrapper.
- Never swap one pane for another with a ternary. `{terminalActive ? <TerminalTabs /> : <DiagnosticsPanel />}`
  is not a view switch, it is an unmount: it ran the terminal's cleanup, detached the socket, and let the
  server kill every shell ten minutes later. Render both and hide one. A pane the user has never opened is
  genuinely absent, and a conditional mount is right for it; this rule is about a pane the user comes back to.
- Collapsing a resizable pane is a size change, not an unmount. `react-resizable-panels` caches layouts
  per registered panel-id set, so removing a panel changes the key its sizes were stored under. Drive it
  to `collapsedSize={0}` and leave it registered.
- A cleanup that is a semantic rollback rather than a disposal must never be hidden. The palette editor
  restores the live theme on unmount and the command palette clears four previews; hiding either reverts
  the app while silently keeping the draft that caused it.
- A pane whose loading, error or empty state replaces its own children throws away everything the
  children held, including an `<Activity>` boundary inside them. `features/git/components/panel.tsx`
  is the live example: its `Activity` pair is `ToolPane` children, so a refetch discards it. Overlay the
  loader over a retained body instead.
```

A second new section, immediately after the one above and still before `## Styling`:

```markdown
## Fragment Refs

- A `ref` on a `<Fragment>` yields a `FragmentInstance` over the fragment's host children:
  `addEventListener`, `removeEventListener`, `dispatchEvent`, `focus`, `focusLast`, `blur`, `observeUsing`,
  `unobserveUsing`, `getClientRects`, `getRootNode` and `scrollIntoView`. It is typed in this build.
- Reach for one when a component must observe, listen to, or focus into children it renders but does not
  wrap. The wrapper `<div>` that exists only to hang a `ResizeObserver` or a delegated listener off is the
  shape this replaces, and deleting that box also deletes a layout box that was changing what it measured.
- `observeUsing` attaches the observer to every host child and re-attaches as children mount and unmount.
  That is the reason to prefer it over a manual loop plus a `MutationObserver` written to notice the loop
  needs re-running. It refuses a fragment whose only children are text nodes, so a `<pre>` of streamed
  output still needs its `characterData` observer — `features/chat/components/activity-detail-section.tsx`
  is the case that stays as it is.
- `focus()` addresses a position — the first focusable descendant — never a named control. A site that
  means "the replace button in this row" or "the search input in that page" keeps its selector, or gets a
  domain action across the boundary. A `FragmentInstance` addresses children, so it can never stand in for
  a child reaching its ancestor.
- Do not delete a wrapper that carries layout, a transform, a positioning context, or an attribute
  `scripts/agent/selectors.ts` matches on. A wrapper removed in this pattern's name that breaks a scenario
  selector is a regression.
```

A new section, after `## Optimization And Performance Work`:

```markdown
## Transitions And The Sync Lane

- `useSyncExternalStore` schedules on `SyncLane` unconditionally. Its change path is `forceStoreRerender`
  → `enqueueConcurrentRenderForLane(fiber, 2)` → `scheduleUpdateOnFiber(root, fiber, 2)`, and lane 2 is
  sync. There is no priority argument and no way to lower it.
- What matters is which state sits behind the hook, not how many hooks there are. Focus, the command bus,
  the editor runtime, navigation, the panel layout and the chat projection all reach React this way, and
  every zustand hook reaches it through the same function. The surfaces you would most want to schedule
  are the ones that cannot be.
- Therefore `startTransition` and `useDeferredValue` around a store write do nothing. Wrapping a store
  setter in a transition, or deferring a value that came out of `useSyncExternalStore`, is code that reads
  like a performance fix and is inert. Do not write it, and delete it where it exists.
- Both still work when the update starts as React state: a `useState` setter, a suspending read, or a route
  change — TanStack Router already wraps every navigation in `React.startTransition`. That is the test. Ask
  which hook produced the update, not how expensive the render is. When a store-driven change must be
  interruptible, republish it as local state at one boundary and transition the republication;
  `features/settings/hooks/use-transitioned-color-mode.ts` is the one place that does this and the model.
- Build a store on `createStore` from `zustand/vanilla` rather than a module `let` plus a listener set.
  A hand-rolled snapshot has to return a stable object identity or `useSyncExternalStore` loops forever;
  `features/logs/state/filter-store.ts` carries the comment from the time that was learned.
- When a store-driven render is too slow the answers are fewer subscribers, a narrower selector, or less
  work per row. Scheduling is not one of them.
```

And one comment, at each store factory the sync-lane mistake would be made near, because that mistake
is made mid-debug rather than mid-read:

```ts
// Every subscriber of this store wakes on SyncLane: useSyncExternalStore calls
// enqueueConcurrentRenderForLane(fiber, 2) with no way to lower it. startTransition and
// useDeferredValue around a write here are inert. Make the render cheaper, not later.
```

Completion: three `AGENTS.md` sections and the store-factory comment read as if they had always been
there, each naming a file in this repository that already does the right thing; the four rules that
cannot be automated say so in this plan rather than in a gate nobody trusts.

## Evidence and limits

**No before/after measurement exists for anything in this plan, and none was taken.** The dev server
is down — ports 5173 and 3001 are closed, and only the mesh on 3301 answers, at
`https://omarchy.mesh.shaulavo.dev/platform`, where `GET /platform/release` reports release
`20260920T125946Z-b915d3e0` with 78 dirty files, over a server bundle built from
`20260920T125500Z-02885149`. Every `bun run agent:browser renders|trace|look|scenario` line above is a
**prescription for the implementer**, never evidence. Evidence directory when the work runs:
`/work/tmp/fregat-evidence/plan128-patterns/`. It must hold the `terminal-panel-swap` screenshots
before and after, the two `trace --compare` pairs from Phase B2 with their freshly captured
baselines, and the `VirtualList` hide/reveal browser-test output.

What the source reads at `b915d3e0` establish:

- The resource chains: `TERMINAL_DETACHED_TTL_MS = 10 * 60 * 1000` at
  `apps/server/src/terminal/service.ts:53`, `void this.dispose({ kill: true })` at `:616`, and the
  `invisible`/`inert` reference implementation at `terminal-tabs.tsx:51-56`.
- Ghostty's zero-size guard: `contentBoxSize` returns `undefined` at width or height 0
  (`fit.ts:214`), `calculateFit` returns `undefined`, `runFit` returns without calling `onFit`. The
  repository comment claiming a display-hidden host makes the grid come back wrong is not supported
  by the library it describes.
- `SyncLane` at `react-dom-client.development.js:8642`; the call-site counts are greps over the named
  roots with tests, browser tests and `node_modules` excluded.
- Fragment Refs typed at `@types/react/index.d.ts:739` and augmented at
  `@types/react-dom/index.d.ts:30-37`, with zero uses anywhere in the repository and zero
  `IntersectionObserver` uses.
- The layout cache at `react-resizable-panels.js:1496` and `:1745`, keyed by the registered panel-id
  set.
- The single `<Activity>` pair at `features/git/components/panel.tsx:113` and `:116`, the single
  `startTransition` at `use-transitioned-color-mode.ts:8`, and `state={{ pending: status.isPending }}`
  at `panel.tsx:69` — which is what discards that pair.

What none of it establishes:

- **The census is a read of source, not a runtime measurement.** No site in the table was driven in a
  browser to confirm what actually dies. A row that says "the scroll offset is lost" is a deduction
  from `display: none` semantics, not an observation.
- **34 of 46 re-checked classifications were overturned** — the label, the reason, the prerequisite or
  the blast radius, and in eleven cases all three. The dominant cause was `display: none` meeting a
  pane that measures itself; the second was reasoning by analogy from the terminal comment; the third
  was stopping one module short of the resource. Treat every row as a starting point requiring a
  per-site drift check immediately before it is executed, and read the two files below the one named.
- **Two census errors are corrected here and named so the pattern is recognisable.**
  `use-pick-entry.tsx` was recorded at `:210`, which is the file's last line rather than the site;
  the anchor is `:68-79`. And `use-tree.ts:42`'s `resetTreeLoad` was described as a live trigger; it
  is returned at `:144` and called nowhere in the repository, so it is dead code. Both errors come
  from recording a grep hit instead of reading the function.
- **Hidden-`Activity` pre-render cost has never been traced.** Nothing in this repository has measured
  what it costs to keep a subtree mounted, rendering, and hidden — not for a stacked bottom panel,
  not for keeping both workbench surfaces alive, not for a retained set of chat sessions. Every
  "cheap" in the table above is an argument, not a number.
- **No render-count or frame-time claim is made.** Fixing an unmount is a correctness change. If a
  `trace --compare` after Phase B2 lands inside the run-to-run spread, the honest report is that the
  observers are narrower and the frame time did not move.
- **Nothing about `apps/desktop`, `apps/site`, or the linked `Editor` and `ghostty-webgpu`
  checkouts**, except as read dependencies. `apps/tui` is read for the sync-lane count only; it runs
  OpenTUI and is not changed.

## Focused commands and test targets

Run only checks for changed behaviour. The failures these catch are a shell killed by a tab click, a
hidden list that returns with a poisoned measurement cache, a focus intent that reports success and
focused nothing, and a snapshot that changes identity without changing value.

```bash
# Baseline and unrelated work
git status --short
git diff --stat b915d3e0..HEAD -- apps/web/src/features/workbench apps/web/src/features/chat-mode packages/ui/src/patterns packages/tree/src

# The list contract and the tree lifetime
bun x --no-install vitest run src/patterns/tests --cwd packages/ui
bun x --no-install vitest run src/tests --cwd packages/tree

# The features that change
bun --bun vitest run --project dom src/features/logs/tests src/features/settings/tests src/lib/focus/tests --cwd apps/web
bun run --cwd apps/web typecheck
bun run --cwd packages/ui typecheck
bun run --cwd packages/tree typecheck

# Browser proof — requires a running dev server, which is down as of this writing
bun run agent:browser look --doctor
bun run agent:browser scenario terminal-panel-swap
bun run agent:browser scenario logs-search-no-flicker
bun run agent:browser scenario tree-sticky-scroll
bun run agent:browser trace editor-split-order --compare /work/tmp/fregat-evidence/plan128-patterns/before-tabstrip
bun run logs --since 5m --level warn

# Whole chain, last
bun run verify
```

Expected: focused tests and changed-workspace checks exit zero, or a documented pre-existing baseline
failure remains unchanged. Never gate on a bare root `bun run verify`; use the per-workspace baseline
delta. The CLI never starts a dev server; if it is down, report the surface as blocked evidence and
say so rather than substituting a unit test.

## Completion contract

- [ ] Switching the chat tool pane away from Terminal and collapsing the chat-mode tool rail both
      keep the session's shell attached, proven by `terminal-panel-swap` and its screenshots.
- [ ] The chat-mode tool pane's branches are stacked at the call site with `invisible` and `inert`,
      its `TerminalPanel` takes `active={tab === 'terminal'}`, and no new primitive was added to
      `packages/ui`.
- [ ] `chat-mode/components/layout.tsx:80` collapses a still-registered `ResizablePanel` to zero
      instead of removing it, and the revealed host refits with a non-zero box.
- [ ] `terminal/components/panel.tsx:296` renders the unreachable notice over a retained host.
- [ ] The workbench bottom panel was not touched here: `bottom-panel.tsx:65` and
      `workbench/components/layout.tsx:96` stayed with [Plan 127](127-compiler-and-lifetime-repairs.md)
      Phase 3.
- [ ] Both `LogsPanel` call sites pass `active={tab === 'logs'}` inside an `<Activity>`, and the
      conflict comparison keeps both scroll positions across a hide.
- [ ] `packages/tree` separates reversible detach from irreversible destroy, owns the model outside
      the React effect, and has no 1 ms StrictMode timer.
- [ ] `VirtualList` discards zero-size measurements and accepts an owned offset, with a browser test
      that hides and reveals a populated list.
- [ ] `move-tab-to-group-dialog.tsx` and `diagnostic-peek.tsx` focus through a `FragmentInstance` via
      `lib/focus/utils/group-intent.ts`, with a test that plants a `focusableWhenDisabled` button and
      still lands focus.
- [ ] `tab-strip-metrics.ts` and `work-log-scroll.ts` observe through `observeUsing`; their subtree
      `MutationObserver`s are gone; `activity-detail-section.tsx` keeps its `characterData` path with
      a comment saying why.
- [ ] `filter-store.ts`, `view-store.ts` and `navigation-coordinator.ts` build on `createStore` from
      `zustand/vanilla`, with no behaviour change and no performance claim.
- [ ] Three `AGENTS.md` sections and the store-factory comment are in, each naming an exemplar in
      this repository.
- [ ] The evidence directory is named in the report and its screenshots were read back, or the report
      states which surfaces were unreachable and why.

## Not in this plan

- **No repairs.** The compiler bailouts, the two `ref={focusTarget.ref}` destructures, settling git
  stage, unstage and discard from the response, and deleting `PlatformCommandBus.inspect` belong to
  [Plan 127](127-compiler-and-lifetime-repairs.md). So do the workbench bottom panel's two unmount
  sites, `bottom-panel.tsx:65` and `workbench/components/layout.tsx:96`, which are that plan's
  Phase 3 ranks 1 and 2.
- **No touching `diff-pane.tsx:198` or `editor.tsx:320`.** Both spell `focusTarget.ref` into a prop,
  and both compile anyway — Plan 127 measured `_c(78)` and `_c(137)` — because the prop is not named
  `ref` in one and becomes a phi in the other. Renaming either prop to `ref` would re-bail the file.
- **No new `packages/ui` primitive.** A shared wrapper cannot own a boundary whose safety is a
  property of its children.
- **No lint rule or census for anything in this plan.** All four candidates were considered and
  rejected in section D, with the reason. The one automatable React-semantics measure is the compiler
  census and it belongs to Plan 127.
- **No editor lifetime change.** Phase A5 scopes it and closes it. Nothing in `/work/projects/Editor`
  is edited.
- **No `memo()` deletions.** The 24 are deliberate; they guard `VirtualList` rows the compiler cannot
  reach through the render prop.
- **No bundle, chunking or dependency work.** That is [Plan 106](106-boot-weight.md) and
  [Plan 109](109-boot-boundaries.md).
- **No conversion of `workspace/components/view.tsx:22`**, the sidebar tab strip, the chat session
  stage, or `packages/ui/src/patterns/tool-pane.tsx`. Each is blocked on a prerequisite this plan
  lands or scopes, and each needs its own hidden-render cost measurement first.
- **No `keepMounted` change to `packages/ui` portals.** That fix is per-consumer; an always-mounted
  command palette would keep a cmdk instance and its filter running for the life of the app.
- **No remount-key fix in `editor-groups-layout.tsx`.** It is a real defect, and it is a key-correctness
  bug with a library layout cache behind it, not an `Activity` site.
- **No work in `apps/tui`, `apps/desktop`, `apps/site`, or `ghostty-webgpu`.**

## Reassessment conditions

Re-check a census row against source before executing it, and read two files below the one it names.
The row is a starting point; 34 of 46 reviewed rows needed correction, and the three failure modes
were `display: none` meeting a pane that measures itself, reasoning by analogy from the terminal
comment, and stopping one module short of the resource.

If a stacked hidden layer measurably costs frame time on the bottom panel, the answer is not to hide
less — it is that permanent mounting is the wrong trade for that layer, and the terminal's host
should be hoisted out of the switched subtree instead. Measure before applying the shape to a heavier
pane than a diagnostics list.

If the `VirtualList` hide/reveal test proves React's commit ordering already discards zero-size reads,
keep the guard and record the measurement rather than deleting it: the guard is cheap and the ordering
is not a documented contract.

If a `packages/tree` or `@singapore-editor/react` lifetime change turns out to need a breaking API
change in the linked checkout, complete the independent work and report the exact remaining
dependency. Do not disguise a host-side workaround as a lifetime fix.

Future reviews should ask, of any new pane: what does its cleanup release, and who else could own
that? And of any new rule proposed for `AGENTS.md`: what fails when it is broken? If the answer is
"review notices", the rule is a wish. Either find the gate or the type that makes the wrong spelling
impossible, or write the rule, name the file that already does it right, and say plainly that it is
enforced by reading.
