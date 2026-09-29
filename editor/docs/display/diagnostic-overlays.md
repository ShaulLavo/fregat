# Diagnostic overlays

Unused code fades using the alpha of `lsp.diagnostic.unnecessaryOpacity` (`#000a` in dark themes, `#0007` in light themes). Deprecated code draws a strike in the winning text color. Theme changes update existing diagnostics.

`VirtualizedTextHighlightStyle.overlay` accepts `dim` and `textDecoration`. The view merges overlapping masks, uses the strongest dim, and splits at safe UTF-16 boundaries. Syntax and colored range highlights paint explicit-color twins at their original priority. Untokenized text gets a foreground twin. Find opts out of dimming through `dimmable: false`. Colorless washes paint below text colors.

Explicit colors are necessary: Firefox and WebKit resolve a colorless highlight decoration against the element instead of the underlying token; WebKit also lets a higher colorless wash erase syntax colors. Pixel tests exercise washes, fades, strikes, semantic/base colors, Find and same-priority refreshes in Chromium, Firefox and WebKit.

## Verification

E053 completed September 25, 2026. Core tests: 2,789; LSP plugin: 416; Find: 102. All three browser engines pass the paint suite in CI. Platform scenarios `editor-lsp-deprecated` and `editor-lsp-unnecessary` passed in Chromium and Firefox; screenshots show a syntax-colored strike and a faded unused name.

Local typing benchmark (median/p95): original empty mask 0.194/0.295 ms; current empty mask 0.188/0.296 ms; mask over 10% of the viewport 0.332/0.416 ms. DOM timing measures update work; pixel tests validate browser painting.

Mask segments with the same overlay share one base highlight, and range groups re-register only when the registry order drifts. With 200 one-name masks, the same benchmark measured 3.04/7.62 ms before that change and 1.44/2.40 ms after, in Bun with happy-dom.
