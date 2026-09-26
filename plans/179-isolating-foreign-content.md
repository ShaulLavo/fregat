# Plan 179: Isolating content the app did not write

## Status and authorization

- Status: PROPOSED, research first. Requested 2026-09-26 (owner). Nothing here authorizes
  implementation.
- Planned at: Platform `d103638de`, Editor `74e76be`, 2026-09-26. Origin: a discussion of the file
  tree's shadow root. [Plan 178](178-tree-in-the-app.md) removes that root. This plan asks where a
  root earns its place instead.

## Outcome

Each surface that shows markup the app did not author gets the isolation it needs, backed by a
measurement: a shadow root where CSS and ids must not cross, a sandbox where script must not run,
or nothing where the measurement says the boundary costs more than it saves.

## Owner direction

- 2026-09-26: look into mermaid diagrams, previews and the editor surface, and find out whether a
  shadow root helps each one.

## What a shadow root gives and costs

- **Gives:** the app's stylesheet stops matching inside, the content's `<style>` stops matching
  outside, ids and `url(#…)` references resolve per root, and style invalidation inside the root
  only consults the root's sheets.
- **Costs:** Tailwind and theme tokens stop at the boundary unless re-adopted; events retarget to
  the host; `aria-describedby` and other id references cannot cross; `<use href="#…">` cannot reach
  a document sprite; `document.querySelectorAll` stops at the host; selection and hit-testing APIs
  differ by browser.
- **Does not give:** script isolation. An HTML preview that may run script needs a sandboxed
  iframe or a CSP `sandbox` response header.

## Findings

### 1. Mermaid in chat

- `features/chat/state/mermaid.ts:69-83`: `securityLevel: 'strict'`, no `themeVariables` (diagrams
  ignore the palette), `htmlLabels` unset so flowchart labels are HTML in `<foreignObject>`, ids
  from a module counter `chat-mermaid-N`.
- `assistant-markdown-mermaid.tsx:63-69` injects the SVG string with `dangerouslySetInnerHTML`.
- The SVG's `<style>` is prefixed with `#chat-mermaid-N`, but `@keyframes dash`,
  `edge-animation-frame` and `:root { --mermaid-font-family }` are global. A `classDef` named
  `hidden` or `flex` picks up Tailwind's `.hidden` or `.flex`.
- `mermaid.render` is called without a container, so labels are measured in `document.body` and
  shown in the chat's `text-sm` block. Different fonts at measure and paint clip labels.
- Mermaid removes `#<id>`, `#d<id>` and `#i<id>` with `getElementById` before rendering.
- No scenario and no mermaid log events exist. Coverage is `tests/mermaid-fence.browser.tsx`.

### 2. Chat markdown and previews

- Chat markdown is sanitized hast rendered as React (`packages/markdown/src/utils/hast.ts:23-36`).
  No innerHTML, no `<style>`, no `<svg>`, classes only on code.
- `packages/markdown/src/utils/sanitize-schema.ts:21` sets `clobberPrefix: ''`. Its comment says
  ids were already prefixed, but only footnote ids are, so raw-HTML ids land unprefixed: they can
  collide with app and mermaid ids and clobber `window[id]`. Restoring the prefix fixes this; a
  shadow root is not needed.
- LSP hovers build DOM with `createElement` and `textContent`
  (`Editor/packages/plugin-ui/src/markdownTooltip.ts`). Low risk.
- No HTML, SVG or markdown preview surface exists. Images go through `<img>`, which isolates SVG.
- `apps/server/src/fs/routes.ts:161-171` serves `.svg` and `.html` from the app origin with their
  native content type, no CSP and no `Content-Disposition`. Opening such a URL runs its script as
  the app. That is a separate fix, and a precondition for any preview.

### 3. The editor surface

- Editor CSS (17.7 KB) is global. The app styles the editor through descendant selectors in
  `packages/ui/src/styles/globals.css:941-1075`, some keyed on ancestors outside the would-be host.
- The Editor writes rules into `document.head`: per-view highlight `<style>` elements
  (`virtualizedTextViewHighlights.ts:1410-1427`), `SharedStyleRules` (`style-utils.ts:145`), and
  shared `::highlight()` rules whose comment notes a head `<style>` per mount triggers a
  document-wide recalc (`sharedTokenHighlights.ts:17-22`). In a root, all of these move inside it.
- Document-scoped APIs in use: `getSelection` (`inputSelectionController.ts:1543, 3440, 3738`),
  `caretPositionFromPoint`/`caretRangeFromPoint` (`virtualizedTextViewHelpers.ts:488-491`),
  `activeElement` checks (`inputSelectionController.ts:3474, 3484, 3736`, `plugin-ui/tooltip.ts`,
  `lib/clipboard.ts:116`), EditContext on a div (`virtualizedTextViewHelpers.ts:165-171`), and
  `performance-trace.ts:374-382`'s document queries.
- Existing trace, `editor-type-burst` (300 keys, 2026-09-25): about 1.1 ms of `UpdateLayoutTree`
  per keystroke, median recalc 0.12 ms touching one element, p90 0.68 ms. Script time dominates.
- The global sheet is 159 KB (28 KB gz), 1,772 rule blocks, about 133 selectors whose rightmost
  compound matches any element, and 42 `:has()` rules. One of them,
  `.focus-ring-within:has(:is(input,textarea,[contenteditable=true]):focus)`, is triggered by the
  editor's own input.
- `scripts/agent/trace-summary.ts:42-45` folds style recalc into "layout", so the `trace` verb
  cannot report it alone.

## Research questions

1. **Mermaid.** Does rendering into a container inside a shadow root, with a small adopted sheet
   carrying the UI font and palette variables, stop the label clipping and the `classDef`
   collisions? Should `themeVariables` come from the palette in the same pass?
2. **Style recalc in the editor.** How much of the 1.1 ms per keystroke comes from app rules
   invalidating editor rows, and how much from the Editor's own head `<style>` rewrites? Answer the
   second before building a root: it may be the cheaper structural fix.
3. **Editor inside a root.** If the numbers justify it: which of selection, hit-testing, focus,
   EditContext and IME survive in Chromium and WebKit, and what replaces the `globals.css`
   descendant selectors (host attributes, `::part`, variables)?
4. **Previews.** When a preview surface is planned (Plan 159, Plan 156), which layer does each
   format need: shadow root for sanitized markup, sandboxed iframe for anything that may carry
   script.

## Proposed phases

Confirmed or reshaped once Phase 0 lands.

0. **Instruments.**
   - Split style recalc from layout in `trace-summary.ts`.
   - A mermaid scenario covering label clipping across font and density settings, a
     `classDef hidden` diagram, and a message carrying `id="chat-mermaid-N"`.
   - An `editor-type-burst` run with invalidation tracking on, attributing recalcs to rules.
1. **Mermaid in a root.** Render into a shadow-root container, adopt one sheet shared by every
   diagram, derive `themeVariables` from the palette. Re-run the Phase 0 scenario.
2. **Cheap fixes found on the way.** Restore the sanitizer's `clobberPrefix`. Serve `/fs/blob` SVG
   and HTML with `Content-Disposition: attachment` or a CSP `sandbox` header.
3. **Editor experiment.** A `/dev` tab mounting the editor inside a root with only its own sheet.
   Compare `editor-type-burst` and `editor-caret-burst` against the normal mount with `--compare`.
   Go or no-go goes to the owner with the numbers; the Editor-side work would be its own plan.

## Verification

- Every claim cites `agent:browser trace` before and after with `--compare`, using the split
  style bucket from Phase 0.
- Mermaid changes are checked with `look` on the Phase 0 scenario in light and dark palettes.

## What this plan does not do

- It does not build a preview surface. It sets the isolation rule a preview must follow.
- No terminal work: the terminal is a WebGPU canvas.
- File-type icons already rewrite their gradient ids per `useId`; they stay as they are.
