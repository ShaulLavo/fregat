# E050: Host obligations now owned by the API

Completed 2026-09-25. The eleven audited workarounds have public contracts and migrated callers.
Platform Plan 130 removes the host copies; Editor owns the presentation and interaction ordering.

| Former host obligation | Public contract |
| --- | --- |
| Reapply tokens after text replacement | `setText(text, { tokens })` paints both atomically; `syncText` and `openDocument` share the contract. |
| Remember diff-only options | `createDiffEditorOptions()` supplies the preset, including `folding: false`. |
| Write private typography variables | `fontSize`, `fontFamily`, `lineHeight` and measured `snapshot.metrics`. |
| Override private theme selectors | Named selection, inactive selection and popup colors; registered `diff.*` colors. |
| Register pointer listeners before core | `registerPressParticipant` claims presses; `registerNonCaretRows` handles keyboard navigation. |
| Race completion and signature-help key listeners | Extensible keymap contexts and commands in the `suggest` pack. |
| Observe inline style to find reservation changes | `onDidChangeReservedOverlayWidth` reports changes, including reentrant layout. |
| Read raw scroll before the virtualizer updates | `Editor.onDidScroll` reports the current position; contribution `setScrollPosition` updates both axes. |
| Punch through gutter pointer-event CSS | Gutter contributions declare `interactive`. |
| Retain recycled row elements during animation | Contribution `getRowPresentation(displayRow)` returns a disposable element handle with an abort signal. |
| Guess when syntax highlighting has settled | `initialHighlightStatus` exposes pending, ready and error outcomes. |

A row presentation handle is invalidated before text replacement, row release, and view disposal.
Acquisition is blocked during invalidation, including from abort callbacks, until the replacement
presentation is complete. Decoration, position and chunk-window updates preserve the handle;
releasing it does not abort its signal. Decode owns its animations, listens for invalidation, and
cancels active reveals on every viewport change. Viewport restoration while highlighting is
pending preserves the wait. This follows the owner's 2026-09-25 choice to keep reveal in the plugin.

The theme API registers diff colors explicitly when the plugin is created, so tree shaking cannot
remove their defaults. Popup copies remove variables the source has cleared. `DiffPlugin.getStackedRows()`
exposes both sides under the current expansion state for all diff modes, allowing host line selection
to use the displayed projection.

Regression evidence lives alongside the corresponding owners, including core
[rowPresentation.browser.test.ts](../../packages/editor/test/rowPresentation.browser.test.ts),
[themeColors.browser.test.ts](../../packages/editor/test/themeColors.browser.test.ts),
[diffThemeBundle.node.test.ts](../../packages/editor/test/diffThemeBundle.node.test.ts),
[decode tests](../../packages/decode/test/plugin.test.ts), and
[popup theme tests](../../packages/lsp-plugin/test/popupTheme.test.ts).
