# Restore the visible workspace on reload

Design rationale, 2026-09-07. [Plan 085](../plans/085-instant-workspace-reload.md) owns the implementation sequence and completion checks. Implementation has not started.

Reloading a workspace should show the selected tabs, visible content, and scroll positions together on the first application-content paint. Live responses can update that view afterward. No pane should briefly show a different tab, default settings, an empty result, or incomplete text because its restoration ran later.

The target is a previously viewed workspace with a valid local cache. A new browser still needs to fetch unknown content. An inactive tab need not construct an editor or load its whole document during startup.

## What is missing today

| View        | What survives reload                                                    | Remaining work                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application | Address, appearance, workspace tabs and layout, cached machine identity | Cached runtime is constructed in a React effect. Prepare initial state before mounting the app.                                                             |
| File tree   | Root and selected file                                                  | Save loaded directory entries, expansion, selection, and scroll. Initialize the tree with those inputs.                                                     |
| Settings    | A whitelist of preferences used during boot                             | Save the displayed settings data and view state. The form currently waits for the full settings document. JSON also waits for document and view attachment. |
| Git         | Open tab and workspace                                                  | Save the observed status, sections, and scroll. Status and changes currently require network responses.                                                     |
| Diff        | Selected file and exact object IDs                                      | Restore the matching blob pair or bounded visible diff, view mode, collapsed regions, and scroll. Data arrival alone does not finish native editor paint.   |
| Search      | Completed query, matches, previews, counts, and collapsed groups        | Restore viewport inputs and scroll. Current virtualizers measure after mount, and initial effects reset scroll.                                             |
| Chat        | Shell, bounded recent transcripts, drafts, and provider display         | Prioritize the visible session and visible message range. Restore omitted visible plan/checkpoint summaries, scroll anchor, and layout inputs.              |
| Editor      | Bounded visible text, highlights, gutter, folds, guides, and scroll     | Preserve the existing matching-paint handoff. Resolve its timeout behavior and complete typography/layout admission.                                        |

Source anchors are [bootstrap](../apps/web/src/components/application-bootstrap.tsx), [workspace persistence](../apps/web/src/features/workspace/hooks/use-cache-persistence.ts), [settings page](../apps/web/src/features/settings/components/page.tsx), [search state](../apps/web/src/features/search/state/buffer-state.tsx), [Git status](../apps/web/src/features/git/hooks/use-status.ts), [chat cache](../apps/web/src/features/chat/state/chat-projection-cache.ts), and [editor snapshot](../apps/web/src/features/workbench/hooks/use-editor-visible-snapshot.ts).

Two live probes warmed the current published workspace and then held API responses during reload. The file view restored its editor preview and 12 tabs, while the tree showed loaders. The preview disappeared after its 1500 ms deadline without live text. The settings probe restored the selected settings tab, but its contents stayed behind a loader.

These probes demonstrate missing content and timeout behavior, not an end-to-end performance target. Their frame samples preceded browser paint, and the broad API hold also intercepted the font endpoint. Separate font and data delays when measuring geometry. Local evidence is in `/work/tmp/platform-instaload/boot-baseline.json` and `settings-baseline.json`.

## Recommended design

Restore feature data into the existing renderers before their first render. Keep the editor's bounded paint snapshot for the work needed to construct a live document and finish highlighting. Use a similar paint contract for native diff or search editors only where measurements show that restoring data and initial geometry cannot meet the first-paint requirement.

The shared code owns cache admission, identity, size limits, and the initial application state. Each feature owns its saved data shape, renderer, and live reconciliation. This avoids a global screenshot renderer and avoids teaching every component how to parse storage.

Every view follows the same behavior:

1. Select the requested view from the URL and local window state.
2. Read its bounded saved state before the view mounts.
3. Render saved content if its identity and presentation inputs match.
4. Revalidate with the existing feature owner in the background.
5. Reconcile matching live content without resetting selection, scroll, focus, or input.

A cache miss shows the normal pending state. A completed live empty result can show an empty state. A refresh failure preserves useful saved content and exposes the connection or refresh failure without replacing the whole pane.

## Shape and ownership

The following names are design sketches, not APIs already present in the repository. The intended caller does one initial read; pane components do not perform their own storage reads in mount effects.

```ts
// main.tsx, after restoring the URL and appearance
const initialView = readInitialApplicationView(window.location)

createRoot(root).render(
	<ApplicationBootstrap initialView={initialView}>
		<App />
	</ApplicationBootstrap>,
)
```

The existing runtime owner takes this initial view when constructing stores. Construction must be safe to perform before the first render. Subscription startup, network work, and disposal remain explicit lifecycle responsibilities of that owner. React Strict Mode must neither duplicate live activity nor reuse a disposed runtime.

Feature hooks return a display state that distinguishes saved observations from current data. A minimal common vocabulary is:

```ts
type DisplayState<T> =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'saved'
      readonly value: T
      readonly observedAt: number
      readonly refresh: 'pending' | 'failed'
    }
  | { readonly kind: 'live'; readonly value: T }
  | { readonly kind: 'unavailable'; readonly message: string }
```

The type is a display contract. Mutation services obtain their authority from the current feature owner. For example, a settings form may display a saved projection while the settings query still has no confirmed document. Installing that saved document as a confirmed query result would break this separation.

Existing renderers continue to receive their domain data. A settings page uses its display projection; a file tree uses directory entries and tree view state. Feature-specific hooks hide the choice between saved and live data. There is no generic registry of callbacks for arbitrary pane lifecycle stages.

The module boundaries are:

| Owner                                                           | Responsibility                                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `state/bootstrap-runtime.ts` and `state/application-runtime.ts` | Assemble the addressed initial view and initialize existing feature owners. Preserve environment retention and lifecycle ownership. |
| `lib/` cache infrastructure                                     | Validate bounded records and enforce storage ownership. Import no feature modules.                                                  |
| Feature `state/` modules                                        | Capture and restore the feature's data and view state, using its existing schemas and live update path.                             |
| Existing feature components                                     | Render the same model initially and after revalidation. Seed virtualizer geometry and scroll before their first visible output.     |
| Editor and diff packages                                        | Own native document and paint readiness. Platform persists supported paint and handles admission and display.                       |

## Identity, storage, and input rules

Saved content is associated with the environment identity, stable workspace ID, and exact view identity. A file uses its canonical path and known revision. A historical diff uses its complete object pair and relevant path. Search includes its query and options. Chat includes its session and message identities. Settings preserves the distinction between the primary settings owner and the active editor owner.

Window-specific selection, scroll, and expansion must survive reload without another open browser window overwriting them. Prefer a per-window record for this state. Shared content can use separate identity-keyed records. Restore the explicit URL first; a saved record must never redirect a shared link to a different workspace or selected tab.

Keep a small synchronous record for the currently visible views and the state needed to position them. Do not serialize every query, every expanded descendant in a repository, or every open file. Bound capture work as well as stored bytes. Admit complete usable records; an oversized record is a cache miss, not a partially valid tree or diff.

Choose aggregate and per-feature byte budgets after measuring representative saved views. The existing editor limit of 256 KiB is a safety ceiling, not proof that seven such records are cheap. The initial implementation must record synchronous read, parse, validation, and materialization costs before increasing those limits. Use existing lifecycle flushes so a normal reload does not lose the last selection or scroll change.

Schema mismatches are discarded. No compatibility migration is needed. This work adds internal cache records, not user-facing settings or preference keys.

Cached data supports immediate local navigation, selection, and scrolling where the renderer can do so correctly. Settings writes, Git mutations, search replacement, terminal input, and chat sends continue through their existing live owners. A restored preview cannot authorize an operation or silently queue an action against an unverified machine.

Native editing becomes available only when the live document can accept input. Until then, show an explicitly read-only view that does not accept or queue typing. Controls that already accept local input must preserve it across revalidation. Once live input starts, delayed restoration cannot overwrite it or restore the previous scroll position.

## Slow connections and paint handoff

Preserve saved read-only content while its matching live view is still pending. Change the editor's current 1500 ms dismissal into an explicit waiting or failure state when there is no live content to reveal. This is a deliberate change to the original snapshot policy, which used the deadline to prevent a preview from hiding a stalled editor.

That change must retain an observable live failure. A real missing-file response, identity mismatch, changed revision, incompatible paint format, or user navigation ends the old preview. A network timeout can retain saved content with a clear retry state. Never report the cached preview as live readiness.

Update interaction-triggered dismissal with the timeout change. The current pointer, focus, key, touch, and wheel handlers can also erase the only visible editor. Interaction may reveal the live editor when it is ready; otherwise keep the saved view and its waiting state. Do not replay that interaction against a later document.

Data renderers reflow for the current pane size. Absolute editor paint requires matching layout and typography or a supported reprojection. Save row or item anchors with offsets, not just raw page scroll. Restore first-load scroll immediately; keep animation for subsequent user navigation. A pane becomes live independently of other panes.

## Implementation and verification

[Plan 085](../plans/085-instant-workspace-reload.md) contains the ordered milestones, package dependencies, browser proof, and completion checklist. It starts with measured budgets and bootstrap, then proves file tree and settings before extending the design to the remaining views. Terminal replay is required for overall completion.

The first acceptance gate is correct visible content before live responses complete, followed by stable handoff. Timing measurements separate initial content from live readiness so a cached preview cannot be counted as a finished connection or editor.

## Alternatives

A whole-workbench inert presentation record could reproduce many panes in one initial frame. It would also need capture/render support for forms, trees, virtualized chat, terminal canvases, and their interaction handoffs. A screenshot cannot reflow or accept normal input. Typed duplicate renderers would repeat layout logic already present in these features.

Persisting the entire QueryClient is shorter to introduce, but does not restore scroll, measured geometry, native editor paint, or settings ownership. It can also promote old observations into mutation inputs. Feature-owned saved observations with shared admission are the recommended base. Take independent pane readiness and continuous pending-content display from the presentation-record alternative. Retain the editor's existing paint approach where it provides a capability that data restoration cannot.
