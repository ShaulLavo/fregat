# Plan 209: One workspace for chat and code

Status: APPROVED for design review, reconciled 2026-09-29. Planning and a plan-only PR
were requested on 2026-09-28. No implementation, dependency changes, state resets or deployment are
authorized by this document. Merging this plan records direction; implementation
requires a separate owner decision.

Scope: the wide web workspace and desktop clients that use it. The phone shell,
native client and TUI keep their own presentation contracts. Execution order and
cross-plan dependencies remain in [PLAN.md](../PLAN.md).

Current scheduling: [207](207-one-repo-with-mirrors.md) owns package relocation;
[202](202-tui-ui.md) owns the separate app-local terminal UI. Align command changes
with [206](206-platform-one-keymap.md), and add new app copy through
[208](208-all-text-in-json.md) as its catalogs land. Preserve the design decisions
and implementation authorization below; merging this documentation resolves neither.

Source baseline: Fregat `794a6414e0b9c753a9ce79d5eb26d4da0d0af75c`, inspected on
2026-09-28. Source links below are pinned to this revision. Reconcile main and open
PRs before implementation. This is a source review, not a completed usability test.

Before publishing, main advanced to `bafc8b34c8b8cbf7842419830638d59649568adf`.
Its two-commit delta was checked: a Plan 201/index update and a stale Git-row
navigation fix. This plan is based on that head and preserves the fix: when a
clicked change no longer exists, refresh status and keep the current view. [S13]

## 1. The product in one minute

Keep the session browser as its own column. Keep project tools, such as Files and
Git, in a separate column. Both columns collapse and reopen independently. Put
conversations in the same tab-and-split workspace as files and diffs.

A user can keep Sessions, Files, an editor and a conversation visible together.
Hiding Sessions gives the familiar editor arrangement. Hiding project tools gives
the familiar large-chat arrangement. Neither action replaces the workspace or
closes the content on it.

Retain the classic terminal experience: file tree on the left, code above,
multiple small terminal sessions below. Individual terminals can also occupy
workspace tabs and arbitrary nested splits. A possible sidebar home for the
compact terminal panel is a separate, explicitly reviewed extension.

The layout system arranges known views. It does not manage agent execution,
rebuild the document service, invent another split tree or automatically repack
panes when new work arrives.

### Direction accepted in the discussion

- Sessions and project tools may occupy two columns, provided each is easy to
  collapse and reopen without hiding the other.
- Chat should participate in the existing workspace tabs and splits; it must be
  possible to see a navigator, a file/diff and a conversation simultaneously.
- Horizontal and vertical splits can nest. There is no permanently fixed chat lane.
- Preserve an easy classic editing arrangement and audit keyboard behavior before
  changing the meaning of existing commands.
- Keep existing multi-project/environment/session switching. Describing that
  existing behavior again does not solve this layout change.
- Keep quick terminals, multiple terminal sessions, large terminal views and
  maximize/restore distinct.

### Proposals requiring review

Exact first-open placement, shortcut changes, session-tab reuse, Classic Editing
restoration, compact-terminal relocation and close behavior are proposals below.
They are not approvals inferred from earlier brainstorming. In particular, the
suggestion to delete the bottom panel was superseded by the requirement to retain
the regular editor experience.

## 2. Existing work: reuse it, and distinguish the two meanings of document

| Existing owner                                                                                                                                                                        | Verified boundary                                                                                        | Relationship to this plan                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Plan 098 delivery](../docs/document-and-tab-domain.md)                                                                                                                               | Implemented typed documents, resource identity, tab instances, save capabilities and comparison targets. | Reuse the delivered tab/document domain. Do not repeat the synthetic-path refactor.                                                            |
| [Document-backed content views](../docs/document-backed-content-views.md)                                                                                                             | Delivered shared content acquisition and attachment for comparisons, conflicts and previews.             | Reuse its comparison, conflict and preview contracts. Moving an existing diff tab or hosting chat needs only the contracts that view consumes. |
| [Plan 099](099-document-contributions.md), [document analysis](../docs/document-backed-content-views.md#analysis-and-attachment-contracts), [197](197-editor-highlighting-service.md) | Existing owners of contribution publication, retained analysis and highlighting.                         | Coordinate only the contracts a view consumes. Do not introduce a second analysis/cache owner or bypass their execution gates.                 |
| [Plan 171](171-composer-on-our-editor.md)                                                                                                                                             | Authoring work has landed; visual editing and the composer migration remain.                             | Composer text ownership is separate from hosting a conversation in a workspace tab. Preserve the current composer while moving its host.       |
| [Plan 182](182-search-view-rendering.md)                                                                                                                                              | Owns search rendering and its composite editing work.                                                    | Reuse the existing search tab; do not make the shell project depend on a new search renderer.                                                  |
| [Plan 156](156-documents-in-the-editor.md)                                                                                                                                            | Rich document formats and their viewing/editing requirements.                                            | Independent of this shell change. New view kinds must not accidentally become saveable files.                                                  |
| [Plan 126](126-t3code-alignment.md), [139](139-acting-on-agent-diffs.md), [169](169-agent-review-mode.md)                                                                             | Existing chat/provider, agent-diff and review responsibilities.                                          | Preserve their behavior and provenance. A full Git/PR host is not authorization for new review/backend features.                               |
| [Plan 143](143-phone-layout.md)                                                                                                                                                       | Phone presentation.                                                                                      | Keep the responsive shell boundary; shared state changes require phone regression coverage.                                                    |
| [Plan 183](183-claude-ide-in-terminals.md)                                                                                                                                            | Agent CLI/IDE integration.                                                                               | Separate work. This plan does not replace chat with an agent terminal.                                                                         |

**What was found about chat documents:** the current `TabContent` supports document
content and Settings. `DocumentRef` includes Git diffs, search, history and other
existing document types, but neither a conversation nor a terminal session is a
workspace-tab member yet. Plan 200 explicitly leaves ordinary chat messages and
tool output on lightweight rendering, with a later acquisition boundary for richer
content. Plan 171 concerns composer drafts. These inspected plans do not establish
an implemented conversation-as-workspace-tab feature. [S1] [S2] [S3]

For 209, a chat tab means a view of an existing session resource. It does not mean
turning the transcript into a writable source buffer, publishing it to LSP, giving
it file-save semantics or replacing the chat renderer. Extend `TabContent` with
explicit non-file variants or the equivalent existing domain abstraction. Retain
`DocumentRef` and its capabilities for the actual document-backed variants.

### Current integration points

| Area              | Current evidence                                                                                     | Work here                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Desktop shell     | `workbench-shell.tsx` branches on `uiMode` into chat or editor surfaces. [S4]                        | Replace the mutually exclusive desktop layouts with one composition.            |
| Chat layout       | Sessions, a fixed ChatStage and one selected tool pane. [S5]                                         | Reuse Sessions independently; move the stage's content into a tab host.         |
| Editor layout     | Sidebar, shared editor groups and a dedicated bottom panel. [S6]                                     | Retain the useful regions and add an independently controlled Sessions column.  |
| Split model       | `EditorGroups`, `GroupNode`, stable group/tab IDs and move/copy placement already exist. [S7]        | Extend capabilities and renderer dispatch, not the geometry model.              |
| Chat ownership    | ChatStage reads one selected-session context and draft generation. [S8]                              | Explicit per-tab session scope is required before two chat tabs can be visible. |
| Tool root         | `useSessionToolRoot` resolves a confirmed checkout and refuses an unknown owner. [S9]                | Preserve that guarantee when removing the single-stage assumption.              |
| Terminal lifetime | A KeepAliveProvider sits above the shell switch. [S10]                                               | Reuse its lifetime boundary for view handoffs; do not tie a PTY to a column.    |
| Panel state       | WorkbenchPanels owns editor groups, terminal records, bottom/tool selection and sidebar flags. [S11] | Evolve the existing owner without keeping old/new durable layout copies.        |
| Commands          | Several defaults and handlers distinguish chat mode from workbench mode. [S12]                       | Make the command target explicit; retain applicable bindings deliberately.      |

## 3. The shell and its visible states

### 3.1 Three independently controlled regions

From left to right, the proposed wide-window order is Sessions, project tools,
then the workspace. The optional compact bottom panel sits below the workspace,
not below either navigation column.

**Sessions** remains the global navigation surface: project/environment grouping,
search, running/unread state, drafts and existing session actions. It is not copied
into each chat tab. Selecting a row opens or focuses that conversation through the
existing ownership/navigation coordinator.

**Project tools** remains a local navigation surface: Files, Git, Search, Logs and
applicable compact tools. Switching its selected tool does not replace a workspace
tab or hide Sessions. The visible header identifies the owning checkout.

**Workspace groups** hold tabs for files, diffs, conversations and other explicitly
supported views. Groups split horizontally or vertically, including nested and
three-group arrangements. Moving a tab is distinct from copying a document view
and from creating another session.

Each navigation column has a visible collapse action, a persistent way to reopen,
a palette command and an independently addressable focus target. Reopen controls
must remain reachable after the column is hidden. Tooltips and menu shortcut hints
use the actual effective keymap. Hiding a focused column returns focus to the last
valid workspace target; it does not hide the other column or change the selected
conversation.

Remember each column's width separately. The project-tools width may grow to the
requested approximate 60% ceiling when space permits, constrained by the remaining
visible regions' minimums. Two columns are not each entitled to 60% simultaneously.
Do not silently collapse a column, move tabs or repack groups to satisfy a resize.
Preserve the current constrained/overflow fallback until a separately tested
responsive alternative is approved. The phone shell does not receive two columns.

### 3.2 Required journeys

| Journey                       | User action                                                | Required resulting layout and behavior                                                                               |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Classic editing               | Open an editor-first workspace with no saved arrangement.  | Files left, existing document area above, multi-session terminal panel below. Sessions can remain collapsed.         |
| Chat-first entry              | Open a session from Sessions.                              | A conversation is visible in a workspace group, with Sessions still available. Do not open a separate desktop shell. |
| Inspect a file while chatting | Reveal Files and select a file.                            | Files, file and chat coexist; Sessions remains visible if it was already visible.                                    |
| Review session output         | Select a session's changes, then a changed file.           | Changes list, the correctly scoped diff and the conversation coexist.                                                |
| Review the checkout           | Explicitly select working-tree/staged scope.               | Show checkout changes, not only the currently discussed session. Existing open session diffs retain their identity.  |
| Review a branch/PR            | Open an available comparison or PR view.                   | It can be another tab beside chat or a diff. Missing backend capabilities remain separately scoped work.             |
| Run a quick command           | Reveal the compact terminal and select a session.          | Existing shell is revealed; a new process is created only by a creation command or explicit empty-state action.      |
| Work in a large terminal      | Open a terminal session as a workspace tab or beside code. | Same session, correct checkout, stable output and focus; other terminal sessions stay available.                     |
| Concentrate                   | Maximize a workspace view, then restore.                   | Restore the prior topology, sizes, tabs and selection without restarting resources.                                  |
| Switch project/environment    | Select a session under another owner.                      | Reuse existing switching/parking behavior and restore that owner's workspace; no unscoped retargeting.               |

### 3.3 Fast access to the regular editor feeling

The normal first-use editor arrangement remains the classic layout. Existing
Files, editor-focus and bottom-panel commands must reach it without drag-and-drop.

For an already customized workspace, propose one explicit **Classic Editing**
action: reveal Files, collapse Sessions, reveal the compact terminal at the bottom
and focus the last editable-document group. Preserve all other open tabs, groups,
column widths and the terminal's previous home in a reversible presentation
snapshot. This action may temporarily conceal other workspace groups; it does not
close or relocate their resources. **Restore Arrangement** restores the snapshot.

This is a review gate, not a requirement to invent saved profiles. Reuse the same
transient presentation mechanism as maximize/restore. If the action cannot preserve
open work and restore without ambiguous nesting, ship explicit show/focus commands
first and leave this convenience action pending. One active presentation snapshot
is enough; stacking focus modes is out of scope. Opening work into a concealed
group exits the temporary focus presentation and reveals the real layout.

## 4. Tabs, sessions and resource identity

### 4.1 Proposed view membership

| View                                            | Identity / content authority                                                              | Important capability                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| File, diff, search, history, conflict, Settings | Existing document/tab domain.                                                             | Keep its existing save, copy, close and retention contracts.                                     |
| Conversation                                    | Explicit environment and session identity; draft views also have a stable draft identity. | Session-backed; no ordinary file Save and no duplicate composer for the same session by default. |
| Terminal                                        | Environment, confirmed checkout and terminal session identity.                            | Session-backed; moving a view never creates a PTY.                                               |
| Full Git view                                   | Environment, checkout and explicit review scope.                                          | Navigation/review view; opens actual diffs through existing document requests.                   |
| Full Problems view                              | Environment and checkout plus display filters.                                            | Diagnostic navigation; opening a location uses the common document destination.                  |
| PR view                                         | Existing provider/repository/PR identity when a reader is available.                      | Review content, not a synthetic filesystem path.                                                 |

Use stable `TabId` and `GroupId` for presentation identity. A session ID, path or
tree position is not a replacement for a view ID. Add capabilities only where an
actual command or renderer needs them. A single app-owned exhaustive dispatcher
is preferable to an extension registry that this feature does not need.

### 4.2 Conversation behavior

Recommended baseline: one open workspace tab per session within its owning
workspace. Clicking the same session again focuses it. A different session opens
or focuses its own tab; it never silently changes the resource behind an existing
chat tab. Ordinary tab close removes the view, not the session or agent run.
Archive, delete, stop and send remain explicit session operations.

Several different conversations in the same supported workspace may be visible at
once. Each must keep its own draft, attachments, pending state, selected model,
permissions, transcript position, streaming subscription and command destination.
A mutable global selected-session pointer cannot be the content authority for all
those views. Session creation replaces the initiating draft tab's resource identity
atomically, even if another tab has gained focus while the request was pending.

The session browser is a directory of work, including closed and running sessions.
Workspace tabs represent open views. Mark the open/focused session consistently;
do not use selecting a row as a second hidden tab-selection system.

Show/focus-chat actions go directly to the relevant open conversation. They do not
require opening Sessions and selecting a row first. If several conversations are
eligible for an attachment or comment, use an explicit recipient or a visible
chooser; never guess a recipient from whichever global session was selected last.

### 4.3 Ownership is independent of focus

Keep the current project/environment switching mechanisms. Removing layout modes
does not authorize cross-project tab mixing or a new workspace-switching backend.

Files and compact Git use the active workspace's confirmed checkout. Clicking a
chat composer must not silently repoint the file tree to a different checkout.
Session-specific actions capture that session's own checkout and environment.
Worktree-scoped entry points retain their existing explicit selection behavior.
If a selected session requires another owner, use the existing switch/open flow;
do not display data under the current root merely because a pane is available.

Every async open, attachment, diff action and terminal command retains its captured
owner. Results from a previously focused tab cannot publish into a newly focused
tab. Closed/deleted sessions, missing worktrees and unavailable environments get
explicit view states and the existing recovery actions.

## 5. Opening rules: navigation and content can coexist

A navigator can point at a document without becoming that document. Start with
ordinary companion groups, not a second editor nested inside a Git tab.

Recommended deterministic document destination:

1. An explicit target group supplied by Open Beside or a placement command wins.
2. For a normal open, an already-open matching document may be focused in its
   compatible owning workspace; an explicit Open Beside can request another view.
3. Otherwise use that navigator's still-valid document destination, then the last
   active compatible document group for this workspace.
4. If no compatible destination exists, create one adjacent to the invoking
   workspace group. When invocation comes from a column and only chat is open,
   create a document group beside chat. Do not replace chat, Git or Search itself.
5. If minimum size prevents a new group, keep the current views unchanged and
   offer explicit maximize/open-current-group actions. Never silently evict chat.

Resolve the target before asynchronous work starts. Invalidate a remembered group
when it closes or belongs to another workspace. Removing a remembered destination
is ordinary cleanup, not a generalized placement-policy engine.

Browsing results reuses a clean preview tab in the destination group. Editing or
explicitly keeping a preview makes it durable according to the existing editor
rules. Clicking ten changes should create neither ten groups nor ten compulsory
persistent tabs. Do not replace an edited/kept preview. Keep current keyboard
selection versus activation distinctions, and test that pointer or list navigation
does not unexpectedly steal focus from the navigator.

**Review scope stays explicit.** Working tree, index, a session/turn checkpoint and
a branch-base comparison are different inputs. Store scope with the view, display
it in the header and capture it in diff requests. Switching chat tabs never rewrites
an open comparison's scope. A session following live changes must advertise that
policy; an exact checkpoint remains the checkpoint it opened.

**Full Git is not another editor shell.** Initially it reuses existing Git
navigation/content and opens actual source/diff documents into workspace groups.
Inline summaries and metadata are fine. A richer embedded-review alternative can
be evaluated later, using the same document owner, with explicit tab/focus rules.
Do not duplicate buffers or comparison rendering to obtain a large Git view.

## 6. Terminal: preserve the default, add workspace views

### Required first slice

Keep the bottom multi-session terminal experience. Add a workspace view for an
individual existing session, plus **Open Beside** and **Return to Terminal Panel**.
Panel selectors and workspace tabs refer to one session inventory, not two shell
owners. A terminal session is scoped to its confirmed environment and checkout.

Recommended baseline: one attached renderer per terminal session. Moving transfers
that view; selecting a directory entry for a workspace-hosted terminal reveals its
current group. Other sessions remain in their current locations. Preserve output,
scrollback, selection where supported, focus handoff, process status and resize
behavior through the existing keep-alive/session infrastructure. Measure actual
mounts and PTY connections; reusing an ID alone does not prove continuity.

**New Terminal** creates a new session. **Show Terminal** reveals one.
**Move** changes presentation. **Maximize** temporarily changes available space.
**Close View** and **Kill Terminal** must be separate operations. The proposed
Close View behavior retains the session in the terminal inventory and releases its
workspace presentation. The inventory must remain reachable when every view is
closed. Reopening a missing/exited session shows an explicit state; it must not
silently start the command again.

Do not change the existing terminal-close/keybinding behavior without the terminal
review gate below. Running a dev server, an interactive shell and an agent CLI are
required controls. This is ordinary terminal hosting, not terminal-as-chat.

### Optional sidebar home: decision before implementation

The requested sidebar-terminal workflow remains in scope as a design question, not
as a prerequisite for merging chat and editor layouts. Prototype this small rule:
**the compact terminal panel has one home, Bottom or Sidebar; individual sessions
may instead live in workspace tabs.** A visible panel action changes the home and
remembers it. A session action moves only that session. Neither action restarts work.

Recommended icon policy for evaluation: one persistent Terminal launcher, regardless
of panel home. It reveals the compact panel at its remembered home; it is not a new
icon per session and does not appear/disappear when a session moves. Panel location
must be visible in its controls so the launcher is not mistaken for a sidebar-only
tool. If user testing remains confusing, retain bottom plus workspace tabs and
return to the sidebar design separately.

When Terminal uses the project-tools column, Files and Terminal are alternative
compact tools there. Sessions remains independent. To see Files and Terminal
together, use bottom placement or a workspace terminal. Supporting another compact
tool column, stacked sidebar tools or universal sidebar docking is out of scope.

Decide separately whether Problems follows the compact panel's home. Do not move it
implicitly because terminal placement changed. Full Problems can use a workspace
tab without moving the compact Problems presentation.

## 7. Keyboard, focus and command compatibility

This is a product dependency, not polish after layout implementation. Record actual
current commands, effective presets, overrides and handlers before changing them.
The inspected metadata already contains mode-sensitive descriptions and defaults;
for example, `Mod+B` currently refers to the workbench sidebar or the chat session
list, and next-item behavior also depends on mode. [S12]

`Mod` below means the platform modifier resolved by the existing keymap. Preserve
platform/preset distinctions; do not rewrite all chords from memory of VS Code.

| Existing command/behavior                                    | Proposed unified meaning                                              | Verification / decision                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `workspace.toggleSidebarVisibility`, `Mod+B`                 | Toggle project tools only. Sessions has its own toggle.               | Intentional change from chat-mode behavior; requires owner review, visible hints and override handling.                      |
| Sessions collapse/focus                                      | Independently show/hide or focus Sessions.                            | Reuse an applicable existing command; choose a nonconflicting default only after auditing all presets.                       |
| `workspace.togglePanel`, `Mod+J`                             | Preserve bottom-panel behavior in the core release.                   | Sidebar-home extension must explicitly choose panel-identity versus bottom-region semantics; do not silently substitute one. |
| `workspace.revealTerminal`                                   | Reveal the requested/recent compatible terminal at its existing home. | No session creation merely because its view is elsewhere.                                                                    |
| `workspace.newTerminal`                                      | Create a new scoped terminal session.                                 | Current metadata binds `Mod+backtick` to New Terminal; do not incorrectly describe it as the existing toggle shortcut.       |
| `workspace.killTerminal`                                     | Terminate the explicitly targeted session.                            | Distinct from panel hiding and workspace-tab close.                                                                          |
| Next/previous terminal                                       | Traverse terminal sessions within the resolved terminal scope.        | Decide and document traversal across panel/workspace homes; no cross-environment jumps.                                      |
| `workspace.nextItem` / previous and numbered tab navigation  | Workspace tab navigation when a workspace group owns focus.           | Sessions traversal remains an explicit rail/session operation. Audit held-modifier badges and preset-specific group keys.    |
| `workspace.focusFirstEditorGroup` and peers                  | Focus the corresponding workspace group, regardless of view kind.     | Keep structural order stable. Review labels and alias behavior in the VS Code preset.                                        |
| `workspace.splitEditorRight` / Down                          | Preserve document-copy behavior for supported document views.         | Chat and terminal must not clone sessions implicitly; Move Tab and New Terminal are separate actions.                        |
| `workspace.closeCurrentTab` and close-many                   | Dispatch the view's actual close capability.                          | Preserve dirty-document prompts; never kill agents or terminals as a side effect of generic close.                           |
| `workspace.addSelectionToChat`, `Mod+L` in editor            | Attach to an explicitly resolved conversation and focus its composer. | Capture source selection/revision and destination session before async work.                                                 |
| `workspace.showQuickAccess`, `Mod+P`                         | Search files in the explicit active workspace.                        | Opening from chat uses companion rules and the correct environment.                                                          |
| `workspace.toggleUiMode`, `Mod+Shift+M`, show-mode actions   | Desktop modes disappear after cutover.                                | Remove or replace with reviewed presentation/focus commands. Do not retain dead IDs or silently recycle the shortcut.        |
| Find, Save, Undo, Redo, Enter, Escape, terminal control keys | Respect the focused view and existing text-entry rules.               | Composer send/IME, terminal SIGINT and editor save cannot be intercepted by unrelated pane commands.                         |

Audit `workspace-commands.ts`, metadata, effective bindings, command enablement,
focus registration, pane-host actions, menus, Settings rows, command palette,
number hints and browser scenarios together. A command invocation captures a
concrete target; the focused tab changing during an async operation cannot retarget
it. Closing a group or hiding a navigator cancels invalid pending focus requests.

Compile a before/after command matrix on macOS, Windows and Linux, including the
VS Code and default presets and user overrides. Run chord-collision and dispatch
checks in editor text, diff, composer, terminal, Files, Git, Sessions, palette and
dialog contexts. Shared client-core changes must not alter TUI bindings accidentally.

## 8. State, persistence, lifecycle and performance

- Respect the repository feature boundaries: shared pure types remain in the
  existing shared domain; app composition owns feature-aware renderer wiring.
  Do not add feature-to-feature imports or a shared library that imports features.
- Keep one durable group/tab tree in the existing workspace owner. Outer column
  visibility, sizes, selected project tool and compact-panel placement are shell
  state. Do not store another normalized surface tree beside `EditorGroups`.
- Define persistence scopes explicitly: global Sessions filtering/grouping belongs
  to its existing owner; per-workspace tabs, selected tools and terminal homes
  belong to the captured environment/workspace; viewport width preferences are
  per-client layout data. Focus/maximize snapshots are temporary, not remote state.
- Session runtimes remain with the existing orchestration owner. Chat tab hosts
  select that owner's state. Do not start another transport or agent per render.
  Expensive hidden transcripts should release rendering work without ending runs
  or losing drafts. Do not solve retention by mounting every session forever.
- Reuse the keep-alive boundary for terminal handoffs. Verify it supplies the right
  environment/session context when the host moves; provider placement is part of
  correctness, not merely a performance detail.
- Preserve document retention, dirty state, undo, source revision and view-specific
  scroll. Shared buffers do not imply shared scroll or caret. Comparison attachment
  follows the [content view contracts](../docs/document-backed-content-views.md#content-view-contracts),
  which cover neither layout state nor chat resource lifetime.
- Address/deep-link restoration, Back/Forward, session creation and workspace
  parking use the existing coordinator. A copied chat/file/diff address must open
  the right subject in the unified shell without replacing unrelated open work.
  Review old mode-shaped addresses explicitly; do not leave a hidden second shell
  solely to service them. Preserve established external link contracts or approve
  a documented change, using the existing adapters rather than a second router.
- Follow the repository's greenfield state policy: if the development layout cache
  shape becomes invalid, bump/reset that cache rather than add migration shims.
  This does not authorize deleting sessions, worktrees, files, recovery content
  or unsaved text. Specify the exact reset scope and get required authorization.
- The desktop `uiMode` branch can be removed only after callers and address/focus
  behavior have a replacement. Phone and TUI reuse shared domain behavior but
  retain their own shells and command contracts.
- Preserve held-subject loading, render error boundaries, unavailable-environment
  behavior, theme primitives, reduced motion and keyboard accessibility. Two
  visible chats must not cause whole-shell rerenders for each streamed token.
- Measure repeated tab moves, group resize, two streaming chats, terminal output,
  hidden/reopened panes and project switching. Record frame/input timing, retained
  memory, mounted views, subscriptions and PTY connection counts before claiming
  the generalized shell is lighter or faster.

## 9. Implementation units, only after authorization

All checkboxes remain open. Each unit includes tests and removal of the replaced
owner in the same completed cutover. Temporary spikes must not become another
permanent shell or state model.

### P0. Reconcile and decide the interaction contracts

- [ ] Re-read main, open PRs, the document plans and existing shell/terminal scenarios.
- [ ] Inventory all `uiMode` branches, single-session consumers, active-document
      assumptions, pane-host kinds, command predicates and stored/address shapes.
- [ ] Capture baseline behavior for classic editing, chat navigation, multi-session
      terminals, independent editor splits, dirty-close and project/worktree switches.
- [ ] Resolve decisions D1-D6 below with a minimal interactive proof using real
      session/diff/terminal identities. Record accepted and rejected behaviors.
- [ ] Complete the before/after keyboard matrix before implementing the shell.

Exit: concrete opening/close/focus rules and a source ownership map, not a list of
UI components to move. No production implementation before owner authorization.

### P1. Extend the existing tab domain and capture view ownership

- [ ] Add the scoped conversation/draft and terminal view descriptors and required
      capabilities to the existing tab domain. Keep non-file views out of file APIs.
- [ ] Extend tab equality, labels, retention membership, placement, serialization,
      selection and generic command dispatch through the existing owner.
- [ ] Define per-tab chat scope and explicit action recipients. Preserve scoped
      transport ownership, pending operations and draft-to-session promotion.
- [ ] Verify move versus document-copy versus session creation at the pure model
      and actual runtime boundaries; unsupported operations return explicit results.

Exit: existing file/diff/search/Settings behavior remains intact and no chat or
terminal can be accidentally saved, sent to LSP or duplicated as a process.

### P2. Compose the independent navigation columns

- [ ] Reuse Sessions and project-tools components in one desktop shell around the
      existing group renderer and classic bottom panel.
- [ ] Add separate visibility, width, focus and reopen controls with persisted scope.
- [ ] Test all four visibility combinations and constrained widths, including the
      requested large sidebar on a wide viewport.
- [ ] Retain the responsive phone-shell loader and the keep-alive/dialog boundaries.

Exit: both columns coexist, collapse independently and return without replacing
workspace content or spawning resources.

### P3. Host conversations and preserve normal editing

- [ ] Render the existing chat content in workspace tabs using explicit tab-scoped
      session context rather than one selected stage for every view.
- [ ] Wire Sessions open/focus, drafts, direct chat focus and selection-to-chat.
- [ ] Prove two different visible chats retain separate drafts, replies, attachments,
      errors, transcript positions and action destinations.
- [ ] Add accepted maximize/restore and Classic Editing access without discarding
      tabs or creating a second durable layout.
- [ ] Reuse existing workspace switching; preserve chat parity and background runs.

Exit: Files + file + chat, and Sessions + Files + file + chat, work through real
user actions. Hiding either column is independent of chat visibility.

### P4. Route navigation into companion document groups

- [ ] Implement the accepted deterministic target selection through the existing
      navigation service; handle missing groups, minimum sizes and stale async opens.
- [ ] Reuse preview/keep behavior for file, search, Problems and Git opens.
- [ ] Carry explicit worktree/staged/session/turn/branch scope into comparison opens.
- [ ] Preserve the existing diff renderer, actual document identity and the
      [content view](../docs/document-backed-content-views.md) ownership boundary. Extend scope
      labels without recreating Git operations.

Exit: repeated review does not overwrite the conversation or navigator, create
unbounded panes, show the wrong checkout or reuse another diff's scroll state.

### P5. Add terminal workspace views; gate sidebar relocation separately

- [ ] Connect existing terminal sessions to workspace tabs and group placement.
- [ ] Implement explicit return/reveal/new/close/kill behavior after D3 approval.
- [ ] Keep multiple small terminals in the bottom panel and the default classic flow.
- [ ] Measure handoff continuity, output/resize behavior and process lifetime.
- [ ] Implement the sidebar-home option only after D2 and the keybinding/icon
      contracts are accepted. Rejection of that option does not block P2-P4.

Exit: a dev server can remain below code while another existing session occupies a
workspace split, and opening/hiding/moving views never silently restarts commands.

### P6. Rehost full tools without expanding their backend scope

- [ ] Keep the existing compact/full Search presentation on shared workspace tabs.
- [ ] Add an accepted full Git host using existing navigation and comparison opens.
- [ ] Add a Problems workspace view using existing diagnostics/navigation.
- [ ] Audit existing PR readers and reuse them as typed workspace views where
      available. Record missing GitHub capabilities as separate feature work.

Exit: Search/Git/Problems can coexist with chat, files and terminals without a
nested second editor/tab owner. A new PR backend is not required for shell cutover.

### P7. Cut over commands, addresses and stored layout; remove dead mode owners

- [ ] Apply the accepted command matrix, update menus/Settings/hints and remove
      desktop mode predicates only where their replacements are complete.
- [ ] Update navigation/address and storage adapters; specify any development-only
      layout-cache reset and preserve all resource/recovery state.
- [ ] Remove replaced desktop chat/editor layout switching and duplicate tab hosts.
      Retain shared components used by phone and independent client behavior.
- [ ] Run acceptance, focused checks and repository gates. Read browser screenshots
      and capture before/after runtime evidence. Update delivery documentation.

Exit: one desktop workspace owner and no legacy mode-dependent path that can send
an action to the wrong session, root or hidden surface.

## 10. Acceptance matrix

| ID  | Scenario                                                    | Required observation                                                                                             |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A01 | Sessions/tools visible, then collapse either or both        | Other regions and selected tabs remain; every hidden column has a reachable restore action.                      |
| A02 | Collapse the currently focused navigator                    | Focus moves to a valid target; reopen restores width and list state.                                             |
| A03 | Chat only, open Files, click A then B                       | Chat and tree remain; one document destination is reused; A's kept/dirty state is protected.                     |
| A04 | Two chats visible; type, attach, send and stream in each    | No cross-session draft, attachment, request, unread or transcript-position leakage.                              |
| A05 | Draft starts while another chat gains focus                 | The original draft tab becomes its session; the new focus is not hijacked.                                       |
| A06 | Session changes + selected diff + chat                      | Explicit scope/owner, correct diff; selecting another file preserves review layout.                              |
| A07 | Change Git scope while a prior diff remains open            | Prior tab retains its original scope; new open uses the selected scope.                                          |
| A08 | Multiple sessions in one checkout contribute changes        | Checkout scope shows the checkout, not just the focused chat's checkpoint.                                       |
| A09 | Switch project, worktree or environment during an open      | Stale result is rejected or delivered to its captured owner; no cross-root writes or display.                    |
| A10 | Open Search/Git/Problems in a workspace split               | Other tabs survive; commands target the visible resource and correct checkout.                                   |
| A11 | Default classic entry and terminal reveal/new               | Files left, code above, terminals below; reveal does not act as New Terminal.                                    |
| A12 | Server terminal in panel, another moved to workspace        | Stable session IDs and connection/process counts; output and resize continue correctly.                          |
| A13 | Close terminal/chat view, then reopen                       | Running work survives under approved close policy; explicit kill/stop still ends the target only.                |
| A14 | Sidebar terminal home, when approved                        | Multiple sessions remain navigable; Sessions column unaffected; move panel and move session are distinguishable. |
| A15 | Nested horizontal/vertical and three-way splits             | Existing placement invariants hold for mixed view kinds; no implicit chat/PTY copies.                            |
| A16 | Maximize/Classic presentation then restore                  | Prior topology, sizes, selected tabs, bottom location and column visibility return.                              |
| A17 | Reload, Back/Forward, copied deep links                     | Scoped resources and valid layout restore without duplicate tabs, sessions or wrong-root selection.              |
| A18 | Dirty file close-many, diff edits, Settings save            | Existing document safety and capability behavior preserved.                                                      |
| A19 | All keymap contexts/presets/platforms                       | No chord collisions or unintended send/save/kill; numbered hints match actual targets.                           |
| A20 | Small desktop, 60% tool width, hidden columns               | Constraints remain usable; no unsolicited group removal; recovery controls remain visible.                       |
| A21 | Deleted session/worktree, offline environment, module error | Explicit scoped error state; other views continue; retry does not duplicate work.                                |
| A22 | Phone/TUI and current external entry points                 | Their existing navigation/command contracts remain; no forced desktop-column UI.                                 |
| A23 | Sustained output, resize, moves and hidden views            | No accumulating hosts/subscriptions; measured input/scroll behavior stays within project limits.                 |
| A24 | Click a Git row after its change was committed/discarded    | Refresh stale status and keep the current view; no empty replacement tab or destructive navigation error.        |

Implementation verification should extend existing pure group/domain tests,
command/focus/dispatch tests, navigation/restore tests and browser scenarios. The
baseline includes `bottom-panel-persistence` and existing diff-scroll/scoped-session
coverage; recheck their current paths and runnable commands at P0. Use the repository's
actual browser runner, inspect its screenshots and record the release and commit.
Never claim a feature is complete from a type, a mocked reducer or a plan checkbox alone.

## 11. Decisions to settle before the affected unit

| Decision                                 | Recommended prototype                                                                                             | Gate                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| D1: session open behavior                | One open tab per session; new sessions get their own tabs; no global-stage replacement.                           | P1/P3                                      |
| D2: compact terminal in sidebar          | Bottom remains default; one optional sidebar home; persistent launcher; distinguish panel move from session move. | Optional part of P5, not shell composition |
| D3: terminal close/traversal             | Closing a workspace view retains a discoverable session; Kill is explicit; define traversal across homes.         | P5 and related bindings                    |
| D4: full Git diff destination            | Use ordinary companion document groups first; no nested editor owner.                                             | P4/P6                                      |
| D5: two-column keys and former mode keys | Mod+B controls project tools; Sessions gets its own audited shortcut; review mode-key replacement and overrides.  | P2/P7                                      |
| D6: Classic Editing and maximize         | One reversible presentation snapshot; never destroy the underlying arrangement.                                   | P3 presentation actions                    |

The entire plan remains awaiting implementation authorization. Resolving a design
question does not itself authorize starting that phase.

## 12. Non-goals and limits

No resurrection of `packages/tiling`, general surface registry, automatic packing,
floating windows, OS-window management, universal sidebar docking, nested editor
engines, cross-project mixed-pane workspace, agent execution redesign, terminal-as-
chat replacement, composer migration or new GitHub backend. The discussion's
rejected bottom-panel deletion and earlier diagrams are not implementation specs.

Keep the change about coexistence, scoped view ownership and predictable commands.
The full Git experience, better search rendering and richer document content can
improve independently once their hosts have enough space.

## Sources inspected

[S1]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/lib/documents/utils/types.ts
[S2]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/plans/200-document-backed-content-views.md
[S3]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/plans/171-composer-on-our-editor.md
[S4]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/features/workspace/components/workbench-shell.tsx
[S5]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/features/chat-mode/components/layout.tsx
[S6]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/features/workbench/components/layout.tsx
[S7]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/lib/documents/utils/group-types.ts
[S8]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/features/chat-mode/components/chat-stage.tsx
[S9]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/features/chat-mode/hooks/use-session-tool-root.ts
[S10]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/features/workspace/components/view.tsx
[S11]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/apps/web/src/features/workbench/utils/panels.ts
[S12]: https://github.com/ShaulLavo/fregat/blob/794a6414e0b9c753a9ce79d5eb26d4da0d0af75c/packages/client-core/src/commands/workspace.ts
[S13]: https://github.com/ShaulLavo/fregat/commit/bafc8b34c8b8cbf7842419830638d59649568adf
