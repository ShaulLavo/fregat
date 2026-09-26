# Plan 179: Isolating content the app did not write

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — measured per surface. Mermaid gets a shadow root for display;
  chat markdown, previews and the editor get none. Two live bugs found on the way (raw-HTML DOM
  clobbering breaks the editor; occurrence highlights rewrite a head `<style>` every ~3.5 keys).
  Phases below are ready to execute; one owner question on the editor root.
- Phase 1 done 2026-09-26 (wave 2, lane E1): [singapore#42](https://github.com/ShaulLavo/singapore/pull/42),
  in `editor-ref` `ec3fc15`. `p179-type-burst` on a production build, two traces each: head
  `<style>` writes 42 → 1, style recalc 358 → 203 ms (1.26 → 0.71 ms per key on a busier machine
  than the research's 0.76 baseline), recalcs over 100 elements 84 → 1.
- Planned at: Platform `d103638de`, Editor `74e76be`, 2026-09-26. Researched at Platform
  `c130dd35a`, Editor `74e76be`. Origin: a discussion of the file tree's shadow root.
  [Plan 178](178-tree-in-the-app.md) removes that root; this plan asks where a root earns its place.

## Outcome

Each surface that shows markup the app did not author gets the isolation it needs, backed by a
measurement: a shadow root where CSS and ids must not cross, a sandbox where script must not run,
or nothing where the measurement says the boundary costs more than it saves.

## Owner direction

- 2026-09-26: look into mermaid diagrams, previews and the editor surface, and find out whether a
  shadow root helps each one.

## Verdict per surface

| Surface                                               | Isolation                          | Why (measured)                                                                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mermaid diagrams in chat                              | Shadow root for display            | 30 diagrams in light DOM add 0.30 ms of style recalc per editor keystroke (+40%); the same 30 in roots cost nothing measurable. Contains `classDef` collisions at paint.                       |
| Chat markdown, markdown preview (Plan 108)            | None; restore the sanitizer prefix | Sanitized hast carries no `<style>` or `<svg>`. Its only leak is ids and names, and that leak is a live bug (below). A prefix fixes it; a root would not stop `name` clobbering of `document`. |
| The editor surface                                    | None                               | Removing all 398 universal-bucket app rules saves 0.12 ms/keystroke and 0.22 ms per wheel sweep. The largest style cost is the Editor's own head `<style>` churn.                              |
| Images and SVG files (chat, preview, Plan 159 picker) | `<img>`, as today                  | `<img>` never runs SVG script and never shares ids.                                                                                                                                            |
| PDF (Plan 156, pdf.js)                                | None; scripting off                | Canvas plus a class-prefixed text layer. Keep `enableScripting: false` and `isEvalSupported: false`.                                                                                           |
| DOCX (Plan 156, docx-preview)                         | Shadow root                        | It emits document-level `<style>` rules and ids taken from the file: the case a root is for.                                                                                                   |
| HTML files, agent HTML output (none planned)          | Sandboxed iframe, opaque origin    | Only a sandbox stops script. `sandbox="allow-scripts"` without `allow-same-origin`, fed by `srcdoc` or a blob; never an app-origin URL.                                                        |
| `/fs/blob` responses                                  | `nosniff` + `CSP: sandbox` headers | Defense in depth. Today a navigation is refused by the origin guard (below).                                                                                                                   |

## Findings

### Instruments (research question 0)

- `scripts/agent/trace-summary.ts:42-45` folds `UpdateLayoutTree` into "layout". A prototype split
  lives at `/work/tmp/research2/179/agent/style-split.ts`: style (`UpdateLayoutTree`,
  `RecalculateStyles`, `ParseAuthorStyleSheet`) apart from `Layout`, per-action rates, recalc count,
  element-count p50/p90/max, and the time spent in recalcs touching ≥100 elements.
- `browser-179.ts` beside it is a copy of `scripts/agent/browser.ts` with two additions: extra trace
  categories from `P179_TRACE_EXTRA` and local scenarios (`scenarios-179.ts`). With
  `disabled-by-default-blink.debug` Chrome emits a `SelectorStats` event per recalc: per-selector
  elapsed time, match attempts and matches. It inflates style time about 19× (235 ms → 4,435 ms on
  the same burst), so it attributes and never times.
- The probe that found the biggest cost was a `MutationObserver` on `document.head` that drops a
  `performance.mark` per `<style>` text change; the analyzer charges the next recalc to it.

### 1. Mermaid in chat

- `features/chat/state/mermaid.ts:69-83`: `securityLevel: 'strict'`, no `themeVariables` (diagrams
  ignore the palette), ids from a module counter `chat-mermaid-N`. `assistant-markdown-mermaid.tsx`
  injects the SVG with `dangerouslySetInnerHTML` and re-renders only on `[chart, colorMode]`.
- Probe `p179-mermaid` (`/work/tmp/research2/179/agent/mermaid-179.ts`) renders four diagrams under
  the chat's real class chain (`message-bubble.tsx:116`, `assistant-markdown.tsx:88`) and under the
  plan card's `text-xs`, in the running app with its real CSS and fonts:
  - **No clipping in steady state:** 0 of 40 labels clipped in light DOM. Mermaid pins
    `white-space`, `line-height` and `font-size` inline on each label, so the chat's
    `whitespace-pre-wrap leading-5` does not reach them. The label clipping the plan expected
    comes from a **font change after render**: setting `--font-ui` to another family clipped 14 of
    40 labels, because nothing re-renders the diagram. The fix is a re-render key, not a root.
  - **`classDef hidden` hides the node.** Tailwind's `.hidden` matches mermaid's `class="node
default hidden"`: the node is `display: none`. `flex`, `block`, `truncate` apply too.
  - **Mermaid cannot render into a shadow root.** `mermaid.render(id, text, container)` with the
    container inside a root throws `Cannot read properties of null (reading 'getAttribute')`
    (flowchart) and `(reading 'getBBox')` (sequence): mermaid 11.16.1 finds its scratch element
    with a document-level id lookup. Measurement has to stay in light DOM, so a root alone does not
    fix `classDef hidden`: measured under the app's CSS, the hidden label came out 0×0 and painted
    empty inside the root.
  - Each diagram's `<style>` adds 57 rules to document scope and global `@keyframes dash` and
    `edge-animation-frame`. No app keyframe shares those names today.
- **What a root buys, measured on the editor:** `p179-type-burst` with 30 small diagrams mounted
  off screen (1,710 rules):

  | Variant                   | Style ms / keystroke       | Recalcs ≥100 elements: ms |
  | ------------------------- | -------------------------- | ------------------------- |
  | No diagrams               | 0.76 (0.765, 0.762)        | 131–138                   |
  | 30 diagrams, light DOM    | 1.07 (1.101, 1.048)        | 224–230                   |
  | 30 diagrams, shadow roots | 0.79 (0.746, 0.794, 0.826) | 135–151                   |

  The cost lands on every whole-view recalc, so it grows with each diagram left in the transcript.

- No scenario and no mermaid render events exist; coverage is `tests/mermaid-fence.browser.tsx`.
  `stream-code-colour` shows how a native-provider fixture streams a chosen answer, which is the
  route a real mermaid scenario takes.

### 2. Chat markdown and previews

- Chat markdown and the markdown split view (Plan 108, `markdown-preview-pane.tsx`) are sanitized
  hast rendered as React. The preview does not render mermaid; its images and SVGs go through
  `<img>` on `/fs/blob`.
- **Live bug, DOM clobbering.** `sanitize-schema.ts:21` sets `clobberPrefix: ''`, so raw-HTML `id`,
  `name` and `aria-describedby` pass unprefixed (probe `/work/tmp/research2/179/probes/clobber.probe.ts`).
  Scenario `p179-clobber` opens the preview of a file containing `<img name="getSelection">`:
  `document.getSelection` becomes the image, and typing then throws
  `input.ownerDocument.getSelection is not a function` 22 times; `editor.cursorDocumentEnd` and
  `editor.selectLineStart` fail at dispatch. Any repository README or agent reply can carry it.
  Evidence: `/work/tmp/fregat-evidence/20260926T100001Z-scenario-p179-clobber/`.
- Restoring the prefix alone breaks footnote jump links: `mdast-util-to-hast` already prefixes
  footnote ids, and `hast.test.ts:122` pins that the link resolves. The fix passes
  `clobberPrefix: ''` to `toHast` and lets the sanitizer prefix every id once, with `rehypeDecorate`
  rewriting in-document `#…` hrefs to the prefixed id.
- A shadow root would not fix this: named access on `document` (`<img name>`, `<form name>`) is
  scoped to the document tree, and a root would drop the markdown's Tailwind styling.
- **`/fs/blob`** (`apps/server/src/fs/routes.ts:159-171`) serves `.svg` and `.html` with their
  native type and no CSP. A top-level navigation is refused today: `authGuard` needs an allowlisted
  `Origin`, or `sec-fetch-site: same-origin` with an allowlisted `Referer` (`auth.ts:89-99`), and
  every markdown link opens with `noreferrer`. The headers make that independent of link hygiene.
- LSP hovers build DOM with `createElement` and `textContent`; low risk.

### 3. The editor surface

Measured with `p179-type-burst` (300 keys), `p179-caret-burst` (300 moves) and `p179-fast-scroll`
(80 wheel sweeps) on `use-events.ts`, one throwaway server each, a private Vite on 5179 because the
shared one was down. Plan 178 has no committed scroll trace baseline yet, so `editor-fast-scroll`
serves as the scroll baseline.

- **Typing: 0.76 ms of style recalc per keystroke** (the plan's 1.1 ms was the whole
  opened→typed window including the open). About 3.2 recalcs per key; median 1 element.
- **60% of it is the Editor rewriting its own head `<style>`.** The per-view range-highlight
  element (`virtualizedTextViewHighlights.ts:1376-1428`) was rewritten 84–87 times in 300 keys, each
  followed by a recalc of about 264 elements (every mounted row): 131–139 ms of the 229–235 ms.
  The 40 snapshots captured all alternate one thing: the `occurrence-highlight` rule appears and
  disappears. `setRangeHighlight` with no ranges calls `clearRangeHighlight`, which deletes the
  group and bumps `rangeHighlightRuleVersion` (`:243-252`, `:306-316`); the next word brings it
  back. A root would not help: the rows and the rule would share the root.
- **Caret moves: 0.15 ms per move**, ≤4 elements per recalc, no head writes.
- **Scrolling: 2.2 ms of style per wheel sweep**, dominated by 79 recalcs of about 930 new row
  elements each. Inherent to mounting rows; one shared-token rule write per run.
- **The ceiling for a root.** Deleting every app rule whose rightmost compound matches any element
  (398 rules, via CSSOM before the timed part):

  | Scenario    | Baseline style        | Universal rules removed | Saved   |
  | ----------- | --------------------- | ----------------------- | ------- |
  | Type burst  | 0.76 ms / key         | 0.645 ms / key          | 0.12 ms |
  | Fast scroll | 2.20, 2.23 ms / sweep | 1.98, 2.01 ms / sweep   | 0.22 ms |

  Deleting the 36 `:has()` rules saved nothing (0.80, 0.74 ms / key). Selector stats agree: of the
  selector-matching time during typing, 38% is editor selectors; the app's share is led by
  `:where(.spinner-bands, .spinner-rings)` (207,666 attempts, 0 matches: a multi-class `:where()`
  lands in the universal bucket, and its nested `@supports` block repeats it), `*`, `div`, `::backdrop` and Tailwind `:is(… *)` variants.
  Against about 5 ms of main-thread work per keystroke, a root's ceiling is under 3%.

- **What a root would break** (from the code, not built): `getSelection` at
  `inputSelectionController.ts:1543, 3440, 3738` retargets to the host (Chromium) and needs
  `getComposedRanges` (Chrome 137+, Safari 17+); `caretPositionFromPoint` needs its `shadowRoots`
  option (Chrome 128+, Firefox) and WebKit's `caretRangeFromPoint` stops at the host; every
  `document.activeElement` check (`inputSelectionController.ts:3474, 3484, 3736`,
  `plugin-ui/tooltip.ts`, `lib/clipboard.ts:116`) sees the host; the keymap sees retargeted event
  targets; the `globals.css:941-1075` descendant rules keyed on `.app-editor-host`,
  `[data-chat-mode]` and `[data-editor-focus-active]` become host attributes and variables.
  EditContext and IME inside a root were not tested: Playwright WebKit does not start on this host.

## Research answers

1. **Mermaid.** A root with an adopted sheet stops paint-time collisions and removes the diagrams'
   rules from every other surface's recalcs. It does not stop label clipping (that is a font change
   with no re-render) and cannot own measurement (mermaid's document lookup). `themeVariables` from
   the palette belong in the same pass, keyed with the UI font so both re-render the diagram.
2. **Editor style recalc.** Of 0.76 ms per keystroke, 0.45 ms is the Editor's own `<style>` churn
   and at most 0.12 ms is app rules. The churn is the cheaper structural fix, as suspected.
3. **Editor inside a root.** Not justified by the numbers. The replacement map above stands if the
   question is ever reopened.
4. **Previews.** Sanitized markup: nothing beyond the prefix. Libraries that emit their own
   stylesheet and ids (docx-preview): a shadow root. Anything that may carry script: a sandboxed
   iframe with an opaque origin. Images and SVG files: `<img>`.

## Proposed phases

Each phase is independent and shippable. Verification runs through `agent:browser` as noted.

0. **Instruments (S, `scripts/agent/`).**
   - `trace-summary.ts`: a `style` bucket beside `layout`; `recalcs` with count, element p90 and
     time in recalcs ≥100 elements; `compareTraceSummaries` rows for both. Extend
     `trace-summary.test.ts`.
   - `browser.ts trace --selector-stats`: adds `disabled-by-default-blink.debug`, writes
     `selector-stats.json` (top selectors by time and by attempts) and says the timings are inflated.
   - An injected `style-marks.ts` that marks each `<style>` text change and `adoptedStyleSheets`
     write; the summary charges the following recalc to it. Port from
     `/work/tmp/research2/179/agent/`.
1. **Done (singapore#42).** **Editor: stop the occurrence-rule churn (S, Editor `virtualizedTextViewHighlights.ts`).** An
   empty group keeps its rule (as `renderPaintGroup` already keeps it registered), so only a style
   change bumps `rangeHighlightRuleVersion`. Gate: `trace editor-type-burst --compare` shows head
   writes near 0 and style ≤0.35 ms per key. Editor-side test beside `editor.test.ts`'s
   "updates semantic range highlights in place".
2. **Sanitizer prefix (S, `packages/markdown`).** `clobberPrefix: ''` into `toHast`, the default
   `user-content-` prefix back in `sanitize-schema.ts`, in-document `#` hrefs rewritten in
   `rehypeDecorate`. Tests: `hast.test.ts` footnote case plus `<img name="getSelection">`,
   `<form name>`, raw `id`. Scenario: commit `p179-clobber` as `markdown-preview-clobber` (no page
   errors, `typeof document.getSelection === 'function'`).
   Landed 2026-09-26 (wave 2 lane B): `toHast` leaves ids bare, the sanitizer prefixes every
   `id`, `name` and aria reference with `user-content-` (`MARKDOWN_ID_PREFIX`), and
   `rehypeDecorate` prefixes in-document `#` hrefs; chat's fragment-link resolver drops the prefix
   before matching a heading slug. Scenario `markdown-preview-clobber` fails on the old sanitizer
   (`typeof document.getSelection === 'object'`) and passes now.
3. **Mermaid in a root (M, `features/chat`).**
   - Render as today (light-DOM measurement), then mount the SVG into an open shadow root on the
     `role="img"` host with one adopted sheet shared by every diagram (`:host` font, colours from
     theme variables).
   - Prefix `classDef` names in the source before render (`classDef X`, `class ids X`, `:::X`) so
     measurement also escapes Tailwind; a corpus test covers flowchart, state and class diagrams.
   - `themeVariables` derived from the palette; the render effect keys on chart, colour mode,
     palette and `--font-ui`, and awaits `document.fonts.ready`.
   - `chat.mermaid.render` wide event: duration, diagram type, outcome.
   - Scenario `chat-mermaid` on the native-provider fixture: a `classDef hidden` diagram, a font
     switch, light and dark palettes; `look` on each. Gate: `trace editor-type-burst` with 30
     diagrams mounted matches the no-diagram baseline.
4. **`/fs/blob` headers (S, `apps/server/src/fs/routes.ts`).** `x-content-type-options: nosniff` on
   every response; `content-security-policy: sandbox` on HTML, SVG and XML. Route test in
   `apps/server/src/fs/tests/`.
   Landed 2026-09-26 (wave 2 lane B), with `application/xhtml+xml` and XML covered too; route test
   `fs/tests/blob-headers.test.ts`.
5. **App CSS hygiene (S, `packages/ui/src/styles/globals.css`).** Move the spinner palette off the
   universal bucket (a class-keyed selector at zero specificity via `:where()` around a single
   class, the `@supports` block flattened), and audit the Tailwind `:is(… *)` star variants the
   selector stats name. Gate: selector-stats attempts for those rules drop to near zero.
6. **Isolation rule in AGENTS.md (S).** One paragraph: sanitized markup renders in light DOM with
   prefixed ids; library output that ships its own stylesheet or ids gets a shadow root; anything
   that can run script gets a sandboxed opaque-origin iframe. Plan 156's DOCX viewer follows it.

Dropped: the plan's former Phase 3 (a `/dev` tab mounting the editor in a root), pending the owner
question below.

## Owner questions

1. **Editor in a shadow root.**
   - (a) Build the `/dev` experiment anyway and decide on its trace.
   - (b) No-go: the measured ceiling is 0.12 ms per keystroke and 0.22 ms per wheel sweep, and the
     root breaks selection, hit-testing, focus checks and the keymap in every engine.
   - **Recommendation: (b).** Phase 1 alone removes four times what a root could.
   - Decided 2026-09-26: owner — (b), no-go.

Decided 2026-09-26: research recommendation — mermaid gets a root for display only, with
light-DOM measurement, because mermaid 11.16.1 cannot measure inside one.
Decided 2026-09-26: research recommendation — chat and preview markdown stay in light DOM with
the prefix restored, because a root cannot stop `name` clobbering and would drop Tailwind.

## Verification

- Every performance claim cites `agent:browser trace` before and after with `--compare`, using the
  Phase 0 style bucket.
- Mermaid changes are checked with `look` on the Phase 3 scenario in light and dark palettes.
- Raw numbers: `/work/tmp/research2/179/matrix.txt` lists each run's evidence directory;
  `table.py` there re-derives the tables.

## What this plan does not do

- It does not build a preview surface. It sets the isolation rule a preview must follow.
- No terminal work: the terminal is a WebGPU canvas.
- File-type icons already rewrite their gradient ids per `useId`; they stay as they are.
