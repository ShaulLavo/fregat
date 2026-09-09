# Plan 085: instant workspace reload

## Status and outcome

- State: Proposed implementation; not started.
- Created: 2026-09-07.
- Design rationale: [Restore the visible workspace on reload](../docs/instant-reload-design.md).
- Scope: browser and desktop web application. Restore the currently visible workspace, including its selected tabs, panels, content, and view state.
- Prerequisites already present: server-issued workspace IDs, environment-owned runtimes, settings admission, search/chat persistence, and the Editor visible-paint contract. Reconcile their current implementations before editing.
- Package work: native diff/search paint or terminal replay may require a supported Editor or Ghostty API. Those are explicit dependencies of the affected milestones, not permission to claim those panes complete without them.

On a warm reload with valid saved state, the first application-content paint contains the intended visible content before live responses complete. Unchanged responses do not cause missing text, an empty pane, a wrong tab, a scroll reset, or a geometry jump. Each pane reconciles independently when its live content is ready.

A fresh browser with no matching cache fetches normally. Inactive tabs do not initialize whole documents during startup. Transient menus and dialogs are not restored by this plan. Process connections and mutation authority must be established live, even when their previous presentation is already visible.

## Drift check and baseline

The planning baseline is Platform `39b01d42` and Editor `8b89c4f`, with substantial uncommitted work in both repositories. HEAD alone does not identify the observed implementation. Preserve unrelated edits and record the current dirty baseline before implementation.

Run these read-only checks from Platform, then inspect only the relevant changes:

```sh
git rev-parse HEAD
git status --short
git diff --stat
git -C /work/projects/Editor rev-parse HEAD
git -C /work/projects/Editor status --short
```

Resolve the installed Editor and Ghostty packages from the current lockfile and package links. Record the application build actually served by the existing server. Never start another dev server for this work. Keep large artifacts in `/work/tmp/platform-instaload/`.

Two planning probes warmed the published workspace and held HTTP API responses during reload:

- The file view restored 12 tabs and its editor preview. The file tree still showed loaders. The preview disappeared after the existing 1500 ms deadline with no live editor behind it.
- The settings view restored the selected settings tab, but its contents remained behind a loader.

The local probe scripts and JSON results are under `/work/tmp/platform-instaload/`, named `boot-baseline` and `settings-baseline`. Treat them as starting evidence, not permanent test infrastructure. Their broad interception also held the font endpoint. Their requestAnimationFrame samples are pre-paint DOM observations, not proof that every sampled state reached the screen.

## Decisions to preserve

1. Restore feature-owned data into the existing renderers before they mount. Do not persist the entire QueryClient or build a duplicate renderer for every pane.
2. Retain bounded visual snapshots for native editor initialization. Cached paint never seeds editable text, document revision truth, syntax-worker results, or LSP state.
3. Distinguish pending, saved, live, and unavailable display states. A saved result is an observation; only the existing live owner can establish current-state authority.
4. Keep useful saved content during pending or failed revalidation. Report real failures without replacing the whole pane unnecessarily. A definitive identity, content, or target mismatch ends that saved presentation.
5. Use one initial-state assembly step at application startup. Keep feature schemas, capture, and reconciliation within each feature. Do not add storage reads to every component's mount effect.
6. Restore view state before virtualizer construction and first visible output. First-load scroll is immediate. Subsequent user navigation retains its intended animation.
7. Never wait for every pane to become live before displaying or enabling another pane.
8. Unknown coverage is not an empty result. Preserve explicit directory, search, transcript, log, and diff coverage alongside the saved data.
9. Do not add an offline mutation queue. Use existing environment, settings, document, Git, replacement, and provider authority checks across both UI and keyboard commands.
10. Cache versions are discarded on mismatch. No migration or compatibility shim is needed. Internal cache records are not new user-facing settings.

## Data and module ownership

Use the existing feature models and schema-derived types. The common display contract must distinguish saved observations from live data. Keep refresh failure attached to the saved display instead of converting it into an empty state.

| Owner                                                                                         | Implementation responsibility                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/main.tsx`, `components/application-bootstrap.tsx`, `state/bootstrap-runtime.ts` | Read the addressed initial state before mounting app content. Handle the genuinely uncached connection path separately.                                 |
| `state/application-runtime.ts`, `features/editor/state/runtime.ts`                            | Initialize existing owners from saved inputs. Separate preparation from live activity and disposal. Preserve retained environments and dirty documents. |
| `lib/workspace-cache-storage.ts`, `lib/environments/state/scoped-storage.ts`                  | Enforce validated, bounded storage records and their ownership. Keep feature imports out of `lib/`.                                                     |
| `features/workspace/state/cache.ts`, `hooks/use-cache-persistence.ts`                         | Integrate feature view state and lifecycle flushes with workspace restoration. Remove superseded writers in the same milestone.                         |
| Feature `state/` and `utils/`                                                                 | Own saved data admission, schemas, coverage, and view anchors. Stateful owners go in `state/`; pure transforms go in `utils/`.                          |
| Existing feature hooks and components                                                         | Select saved or live display data and use the same renderer. Mutation services remain responsible for current-state admission.                          |
| Editor and Ghostty packages                                                                   | Own supported native paint export and live readiness. Platform owns persistence, identity admission, and display policy.                                |

### Bind content and view state correctly

- Associate every record with its environment ID, stable workspace ID where applicable, and exact feature target. Keep canonical paths for filesystem operations. Names in URLs are decorative.
- Use exact object pairs and paths for historical diffs, query/options identity for search, and session/message IDs for chat. Settings records include the actual settings owner and scope.
- Put window-specific selection, expansion, scroll, and visible-range records in `sessionStorage`. Reload uses that window's record. A duplicated browser tab may start from the copied record, then writes independently.
- Keep durable shared feature caches as scoped fallbacks. A fresh window may use matching saved content, but must not inherit another window's selection over its explicit URL. Storage events cannot overwrite a mounted owner or dirty draft.
- Bind each view anchor to the content generation it describes. For split data/view records, publish the matching view reference last. A torn or missing pair is a cache miss for that view.
- Capture owner and target generation when starting asynchronous work. A delayed response or capture from A cannot update B after a switch.

### Bound work before it reaches storage

Milestone 0 fixes measured aggregate and per-feature ceilings before new caches ship. Record both byte limits and synchronous restore costs. The existing Editor 256 KiB ceiling remains a safety bound; multiplying it across panes is not an accepted startup budget.

Capture only the content needed for visible views plus enough neighboring data to support their initial layout. Bound traversal and serialization as well as the final string. Save complete feature records atomically; omit an oversized feature record rather than inventing partial correctness. Mark any intentionally truncated view with its actual coverage.

Prioritize the visible chat session and message window over unrelated recently updated sessions. Preserve loaded directory coverage without walking the whole repository. Use a supported bounded paint record for a huge diff instead of reading both entire files synchronously during boot.

Retain existing lifecycle flushes and coalesced writes. Do not make correctness depend on an idle callback running before reload. Invalid, unavailable, or over-quota storage falls back quietly to normal loading and produces a bounded diagnostic reason.

## Milestone 0: establish the browser proof and budgets

Deliver a reusable `apps/web/scripts/workspace-reload-proof.mjs` that drives the already running application. Adapt the planning probes, preserving their actual server-issued URL and using real persisted state. Add a package script only when the runnable proof is included.

The proof takes the application URL, output directory, viewport, and scenario. It opens the real app, waits for a positive settled control, then reloads after persistence. Hold selected data responses using CDP Fetch, and control relevant stream handshakes separately. Preserve normal HTTP asset caching. Test font delay separately from data delay. Never print or commit authentication state.

Record a bounded `baseline.json`, `budgets.json`, and per-scenario result with:

- Build and source fingerprints, environment/workspace/view identities, viewport, typography, and theme.
- Cache schema, bytes by feature, aggregate bytes, and read/parse/validation/materialization costs.
- First shell/content paint, saved-content observation, live readiness, and dismissal reason.
- Visible text/row identities, selected tab, scroll anchor, geometry, and exposed blank/mismatched frames.

Use screenshots or compositor filmstrip evidence with frame observations. Calibrate each assertion against the settled control; tree content is inside a shadow root. Add one narrow semantic DOM identifier only where existing accessible names or native attributes cannot identify the view.

Inspect structured logs before attributing a delay. Add one bounded wide boot event and pane readiness/removal fields through the existing logging/trace owners. Do not log source text, chat text, or search text. Distinguish timeout, interaction, target mismatch, content mismatch, and successful takeover.

Measure representative small, large, and scrolled views. Record selected byte ceilings and the measured cost that justifies them. If an input exceeds the ceiling, choose explicit coverage or native visible paint. No later milestone may leave an unbounded synchronous record in place while waiting for a future performance pass.

**Completion check:** the proof reproduces the current tree/settings gaps and editor timeout against the settled controls. Deliberately withholding live responses cannot accidentally count cached paint as live readiness. The committed proof works without the temporary planning scripts, a new server, or hand-manufactured storage.

## Milestone 1: prepare the application before its first render

Refactor the existing bootstrap/runtime owners so a matching cached initial view is available synchronously. Keep appearance and URL restoration before this step. Remove the `application = null` effect-only path for a valid warm restore.

Separate state construction from subscription/network startup. Give the existing application owner an idempotent activation lifecycle and a single disposal owner. Exercise React Strict Mode setup/cleanup/setup, root unmount, and HMR. Do not reuse a disposed runtime or dispose retained dirty environments during a presentation remount.

Keep cached identity as permission to show matching saved content only. Revalidate identity and protocol through the existing connection owner before commands can write. Replace initial false-offline presentation with pending connection state where the outcome is still unknown. Show retry/error states after an actual failure, not because cached startup set an intermediate phase.

Prepare the first addressed tabs and panels together with their feature seeds. Preserve primary settings ownership, active editor ownership, worktree binding, and the A→B→A retention contract. Do not add a second active editor pointer or command bus.

**Focused checks:** extend `features/environments/tests/cached-bootstrap.test.tsx`, scoped-storage/ownership tests, and the current address restore tests. Catch duplicate subscriptions, wrong-owner writes, URL overrides, lost dirty buffers, and a cached identity being admitted as write authority. Run the browser proof with health and data held independently.

**Completion check:** a valid warm restore mounts the requested shell and initial feature owners without an intermediate connecting-only application render. Cold and identity-mismatch paths remain honest. Disposing/restarting activity neither duplicates transports nor destroys retained documents.

## Milestone 2: restore file tree and settings

### File tree

Work in `features/workspace/hooks/use-tree.ts`, `components/tree-pane.tsx`, `utils/tree-pane-state.ts`, and their cache/persistence owners.

Persist loaded directory entries and load coverage with the visible tree's expansion, selection, and item anchor/offset. Restore the model with those inputs before construction instead of creating a closed tree and expanding/revealing selection in an effect. Restore Git decorations from an observation with its own freshness.

Refresh loaded directories without blanking the tree or waiting for every selected-file ancestor before any known rows appear. Preserve existing filesystem-event reconciliation. Re-resolve live entries at the existing file-action boundary. An unloaded saved branch must remain unknown, not become an empty directory.

### Settings

Work in `features/settings/components/page.tsx`, the document/projection hooks, `state/view-store.ts`, `state/scope-store.ts`, `utils/boot-mirror.ts`, and `hooks/use-settings-json-document.ts`.

Persist the displayed settings projection/layers and view state under the correct owner. Restore scope, category, form search, form/JSON mode, and scroll. Continue to use the registry and appearance mirror for first-paint preferences, including diff view mode where required.

Do not seed the current implicitly confirmed settings query with saved data. Display hooks may project the saved observation while the live admission pipeline establishes the current document. Keep raw-file revisions and conflict handling. Only attach a writable settings JSON document after its live owner is ready; use the native saved-paint path if that would otherwise leave visible JSON blank.

**Focused checks:** extend tree query/pane/mutation tests, `features/workspace/components/tree-pane.browser.tsx`, settings page/projection tests, `page-actions-ownership.test.tsx`, raw-conflict/sync tests, and workspace persistence tests. Do not rerun unrelated feature suites.

**Completion check:** tree rows and settings values appear on the first application-content paint with their data responses held. Expansion, scope, and scroll do not reset when responses resume. A stale settings form or tree row cannot bypass command-level write checks. This is the first complete implementation slice of the shared design.

## Milestone 3: restore Git and diff

Work in `features/git/hooks/use-status.ts`, `hooks/use-diff-document-diffs.ts`, `components/diff-view.tsx`, the Git store, and `features/editor/components/diff-pane.tsx`.

Restore observed Git status, counts, sections, commit draft, and scroll without claiming that the observation describes the current index or branch. Preserve a draft accepted by the live UI across refresh. Stage, discard, commit, and sync resolve through current-state services; destructive actions must re-evaluate the intended affected set rather than applying a newly changed set invisibly.

Restore historical diff data by exact object identity. Preserve file choice, split/unified mode, regions, scroll, gutter, and syntax. Do not cache mutable worktree status under an immutable identity or publish historical text as the live file.

Measure native diff preparation after data restoration. If it still exposes incomplete paint, use a supported bounded Editor/diff paint contract. Record a paired package dependency and test it in the package that owns rendering. Do not hand-build a second native diff renderer in Platform.

**Focused checks:** extend Git panel-state and diff-document tests, `features/git/components/tests/diff-view.test.tsx`, environment-ownership/mutation tests, and the relevant native package checks only if its contract changes.

**Completion check:** an exact restored diff and Git list paint before their responses. Unchanged live data preserves layout and scroll. Changed branch/index/file state cannot turn a saved action into an operation on an unintended current target.

## Milestone 4: complete search and chat presentation

### Search

Reuse `features/search/state/buffer-state.tsx` and its existing completed-result cache. Work on `state/result-virtual-window-store.ts`, `hooks/use-result-editor-virtualizer.ts`, `components/results-view.tsx`, and `components/result-editor-surface.tsx`.

Persist the visible anchor/offset and compatible initial viewport inputs. Initialize virtualization from them. Remove first-mount scroll resets for an admitted restore; keep intentional resets for a genuinely new search. Preserve query/options identity, collapsed groups, visible preview text, counts, and truncation.

Treat cached runId 0 results as saved display. Replacement requires a current completed generation and keeps the existing current-text/source guards. If native result-editor initialization still delays visible text or highlights, extend the supported bounded native paint path after measurement.

### Chat

Reuse `features/chat/state/chat-projection-cache.ts`, projection writers, `components/messages-timeline.tsx`, and existing provider display/draft owners.

Prioritize the visible session and visible message window when saving. Preserve the user's anchor when scrolled away from the end; restore following-end only when that was the saved state. Save visible plan/checkpoint summaries and their display coverage without restoring execution, approval, or sequence authority.

Initialize virtualizer geometry with an anchor tied to the same message generation and layout. Reflow for changed width/font/density. Persist bounded rendered inputs for visible code only if needed, keyed by exact text/theme identity and rendered through the same content components. Keep cached detail sequences reset so live stream reconciliation remains authoritative.

Distinguish unknown transcript detail from a confirmed empty conversation. Preserve accepted composer edits across refresh. Provider icons, compact model ellipsis, bubble sizes, attachments, rail headers, and live counters remain part of the first-paint checks.

**Focused checks:** extend search buffer/run/virtual-window/pool/replacement tests, chat cache/timeline/stream tests, and existing real-browser bubble/composer checks. Add focused browser scenarios for both compact and full search renderers and a chat scrolled away from the latest turn.

**Completion check:** cached search and conversation content have the right first visible rows and anchor with streams held. Releasing a stream does not overwrite accepted input, duplicate content, or reset scroll. Missing cached detail never shows a false empty conversation.

## Milestone 5: make native preview handoff continuous

The proposed [editor-owned first-paint design](../docs/editor-first-paint-design.md) specifies provisional native display state, opaque snapshots, and replacement by the first authoritative paint in one commit. It preserves synchronous Editor construction and does not add a separate preview owner. Reconcile that design before implementing the editor portion below.

Work in `features/workbench/hooks/use-editor-visible-snapshot.ts`, its renderer/cache admission, and the native contracts used by milestones 2–4.

Replace deadline-only dismissal with an explicit readiness/failure decision. The current 1500 ms fail-safe must not erase the only useful content while the live document is pending. A stalled or failed live view remains observable through the shared pending/retry presentation and diagnostic reason.

Change interaction dismissal at the same time. Pointer, key, focus, touch, and wheel events currently can also erase the sole preview. Keep it while live editing is unavailable. Never queue or replay that input against a later document.

Native previews are visibly read-only and do not accept typing. Preserve selection/copy for actual selectable displayed content when it is supported; do not expose the existing aria-hidden editor paint as a fake interactive text control. Application navigation stays usable outside the preview. Controls that are already enabled must preserve the input they accept.

Keep current document-generation, revision, theme, highlight, fold, and paint-layer readiness checks. A known mismatch or definitive missing target ends that preview. Include layout/typography compatibility in admission. Reflow normal data renderers; reject incompatible absolute paint unless its package supports safe reprojection.

**Focused checks:** update existing visible-snapshot cache, DOM, and browser tests. Replace tests preserving the old timeout policy. Test every dismissal trigger before and after live readiness, including a genuine failure, a known revision change, resize, theme/font changes, and input immediately after takeover.

**Completion check:** cached text remains visible beyond the old deadline and survives interaction while live data is held. The first exposed live frame includes text, highlights, gutters, folds, and guides in their matching positions. No action is replayed and no saved paint becomes document truth.

## Milestone 6: cover logs, diagnostics, and the visible terminal

Restore a bounded observed range and view state for logs through `features/logs/state/live-cache.ts` and its existing renderer. Preserve filter, visible anchor, and coverage. Start the live subscription normally; saved rows do not establish current connection state or a stream cursor that has not been validated.

Restore visible diagnostics with their document/revision identity through the existing diagnostics owner and `features/workbench/components/diagnostics-panel.tsx`. Discard or mark observations when the corresponding live document changes. Do not expose an old code action as current edit authority.

Inspect the installed Ghostty integration before implementing terminal replay. Restore terminal tab selection and dimensions through Platform's existing terminal owner. Determine whether the package can export and render a bounded viewport with its cells, attributes, palette, cursor, and supported graphics. Reuse that contract if present.

If absent, deliver the minimal supported native viewport contract in the package that owns it, with its own focused verification. Track that dependency here and in `PLAN.md`. Do not serialize arbitrary DOM/canvas internals, add a TypeScript terminal parser, or treat a new PTY replay connection as zero-network first paint.

Persist terminal presentation as read-only saved output. Reconnect using the existing PTY ownership and replay protocol. Admit input only when the actual terminal is ready, and replace saved output only after matching live screen paint. Verify sequence/replay behavior prevents duplicated output.

**Focused checks:** run relevant log-cache/filter tests, diagnostic revision/action tests, and terminal lifecycle/replay tests. Add a real-browser warm terminal scenario. If the package contract changes, run its native/export checks in that repository and record the paired revisions.

**Completion check:** all three tools show their saved visible content and correct view state before live data, with an honest pending connection. A missing native terminal capability leaves this milestone explicitly incomplete. The overall plan cannot be closed as “everything visible” until terminal first paint is proven.

## Milestone 7: verify the complete reload and record delivery

Run the shared browser proof on each visible feature in the workbench and relevant chat layout. Use desktop and narrow viewports. Exercise these cases:

| Case                                             | Required outcome                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Warm reload, responses held                      | Correct selected tab and visible saved content on the first application-content paint; no false-empty verdict. |
| Unchanged live data                              | No exposed blank, missing-text, scroll-reset, or geometry-transition frame during takeover.                    |
| Changed data                                     | Only the matching owner updates. Revision/identity mismatches end incompatible presentation.                   |
| Slow, failed, and retried connection             | Saved content stays useful; actual failure is visible; retry preserves local view state.                       |
| Enabled local input during refresh               | Accepted text, selection, and scroll survive and are applied once.                                             |
| Native preview still pending                     | Editing is visibly unavailable; interaction does not erase content or become queued input.                     |
| Same path on different machines; workspace A→B→A | No data, response, capture, or mutation crosses its owner. Dirty retained documents survive.                   |
| Two windows and a duplicated tab                 | Each window retains its own selected view and anchor after reload.                                             |
| Resize, theme, font, or density change           | Data reflows correctly; incompatible absolute paint is not shown as matching.                                  |
| Corrupt, oversized, torn, unavailable cache      | Normal pending path, bounded cost, no stale partial result or startup-breaking toast.                          |
| Fresh browser/shared link                        | Resolve the exact server workspace ID without requiring browser recents; fetch unknown content normally.       |

Report navigation-to-shell, shell-to-useful-content, live readiness, synchronous restore costs, bytes, and exposed mismatch frames separately. Use repeated paired runs with the same fixture and host before claiming a speed improvement. Record measured spread; do not replace visual correctness with an arbitrary latency number.

Use the repository's narrow test commands. From `apps/web`, run `bun --bun vitest run --project node <relevant-test>` or `--project dom` for the matching local failure. Use the shared fixture/client conventions. The application reload proof runs against the existing server. If a native browser test requires orchestration that starts a second app server, reuse the existing-server proof instead. Run `bun run typecheck` and scoped lint/format checks for changed packages. Package-neutral checks use their normal Vitest runner.

Promote the proof script into the repository in milestone 0, then invoke it from `apps/web` as:

```sh
node scripts/workspace-reload-proof.mjs --app-url='<current shared workspace URL>' --scenario=all --output=/work/tmp/platform-instaload/verification
```

This is the target command to implement, not an existing runnable script at plan creation. Native/browser rendering checks remain separate from node/DOM correctness checks.

Record the final implementation, cache policies, measured budgets, relevant package revisions, and browser results in a stable delivery reference. Update the design explanation to describe shipped behavior. Delete this executable plan and its inventory entry only when every milestone is complete; retain incomplete package dependencies honestly.

## Completion checklist

- [ ] Reusable calibrated browser proof and measured cache budgets.
- [ ] Synchronous warm preparation with correct lifecycle and identity ownership.
- [ ] File tree and both settings views.
- [ ] Git status and native diff content/paint.
- [ ] Both search renderers and visible chat content/anchor.
- [ ] Continuous editor/native preview handoff across timeout and interaction.
- [ ] Logs, diagnostics, and visible terminal replay.
- [ ] Full matrix, focused checks, and delivery evidence.

Writing this plan requires documentation link checks and diff review only. Implementation and publication have not occurred as part of the planning pass.
