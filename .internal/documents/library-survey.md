# Document formats: library survey

Research for [Plan 156](../../plans/156-documents-in-the-editor.md), 2026-09-25. Probes and raw
output live in `/work/tmp/research/156/` (disposable).

## How the numbers were taken

- **Metadata:** `npm view <pkg> version license dist.unpackedSize time.modified` and
  `gh repo view` on 2026-09-25.
- **Shipped weight:** each library bundled alone with esbuild 0.25.10
  (`--bundle --minify --format=esm --platform=browser`, React external), then `gzip -9`. Runtime
  wasm files are loaded with `new URL(...)` and are not in the JS bundle, so they are listed
  separately as `gzip -9` of the shipped `.wasm`. Weight here is what a lazy chunk would download,
  not the unpacked npm size the extend-ui survey quoted.
- **Server conversion:** LibreOffice 26.2.5.2 headless, one `soffice --convert-to` process per
  file with a warm user profile, wall time on this machine (28 cores). Poppler `pdftoppm` and
  `pdftotext` for rasters and text.
- **Samples:** extend-ui's `demo.docx`, `demo.pptx`, `crazy-chart-zoo.xlsx` and `attention.pdf`
  (`references/extend-ui/apps/v4/public/samples/`), mischief-ui's
  `master-services-agreement.docx`, and two Codex template files (`business-review.pptx`,
  `forecast.xlsx`, 15 sheets, 3,807 cells).

## PDF

| Library              | Licence                    | View / edit                                                                                              | Shipped weight (gz)                                    | Notes                                                                                             |
| -------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pdfjs-dist` 6.3.289 | Apache-2.0                 | View, text layer, search. Annotation editor (highlight, free text, ink, stamp) lives in the viewer layer | 128 KB main + 365 KB worker = **493 KB**               | Firefox's engine. 54k stars, pushed 2026-09-25. We would use the core API and draw our own chrome |
| EmbedPDF 2.15.1      | MIT (PDFium is Apache-2.0) | View, annotate, true redaction, forms, signatures, as headless plugins                                   | 195 KB engine JS + 2,086 KB `pdfium.wasm` = **2.3 MB** | PDFium is Chrome's engine. Headless React hooks fit our primitives best. Extend-ui's choice       |
| `react-pdf` 11       | MIT                        | Wrapper over pdf.js                                                                                      | pdf.js + 0.3 MB                                        | Adds little over the core API                                                                     |
| `mupdf` 1.28.1       | AGPL-3.0                   | View and edit                                                                                            | 14.3 MB unpacked                                       | Excluded by licence                                                                               |
| `pdf-lib` 1.17.1     | MIT                        | Write only, no rendering                                                                                 | —                                                      | Last publish 2022-05. The maintained fork is `@pdfme/pdf-lib` 6.1.13                              |
| Poppler (server)     | GPL, run as a CLI          | Raster and text                                                                                          | 0 in the browser                                       | Page 1 PNG at 100 dpi: 42–175 ms. Full `pdftotext`: 7–71 ms (15-page paper: 71 ms)                |

## DOCX

| Library                          | Licence          | View / edit                                                      | Shipped weight (gz)                   | Notes                                                                                                                                 |
| -------------------------------- | ---------------- | ---------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `docx-preview` 0.4.1             | Apache-2.0       | View, as HTML with page breaks, headers, footers, notes          | **50 KB**                             | HTML flow layout: no true pagination, no TOC or field evaluation, weak on drawing shapes. See the screenshot comparison below         |
| `mammoth` 1.12.3                 | BSD-2-Clause     | One-way to semantic HTML, Markdown or raw text                   | 132 KB (browser build)                | Drops styling by design. The right tool for a text projection: 24–42 ms per file here                                                 |
| `@extend-ai/react-docx` 0.9.2    | MIT              | View and edit: track changes, comments, styles, export           | 257 KB JS + 436 KB wasm = **693 KB**  | Rust parser to wasm plus a TS layout (`@chenglou/pretext`). 0.x, one vendor, 23 stars                                                 |
| SuperDoc 2.18.0                  | AGPL-3.0 or paid | Edit on OOXML directly, tracked changes, headless agent API, MCP | **3.4 MB** JS (bundles Vue and Konva) | The most complete browser editor found. AGPL; Platform is a public repo with no licence                                               |
| `@eigenpal/docx-js-editor` 0.5.3 | MIT              | Edit on ProseMirror                                              | not bundled (ProseMirror peers)       | Early. Reported offline in June 2026; the repo was pushed again on 2026-09-25                                                         |
| `docx` 9.7.2                     | MIT              | Create only                                                      | 101 KB                                | What Anthropic's docx skill uses to create files                                                                                      |
| LibreOffice → PDF (server)       | MPL-2.0          | View through the PDF viewer                                      | 0 in the browser                      | 741–788 ms per file, 1,190 ms with a cold profile. Also exports Markdown (568–624 ms) and text (625–706 ms)                           |
| ONLYOFFICE Docs CE               | AGPL-3.0         | Full editor, server container                                    | —                                     | ~500 MB RAM idle ([comparison](https://selfhosting.sh/compare/collabora-vs-onlyoffice/)). Best OOXML fidelity. Too heavy for this app |
| Collabora CODE                   | MPL-2.0          | Full editor, server container, WOPI iframe                       | —                                     | ~1.3 GB RAM idle, 20 concurrent editors. LibreOffice underneath                                                                       |

## XLSX

| Library                        | Licence                                                                               | View / edit                                             | Shipped weight (gz)                    | Notes                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SheetJS CE 0.18.5              | Apache-2.0                                                                            | Read and write values and formulas; styles are Pro only | **138 KB**                             | npm is stale; newer builds ship from `cdn.sheetjs.com`. Read 3,807 cells with formulas in 38 ms                                                             |
| ExcelJS 4.4.0                  | MIT                                                                                   | Read and write with styles                              | 250 KB                                 | Last publish 2024-12, last push 2025-01                                                                                                                     |
| IronCalc 0.8.4                 | MIT / Apache-2.0                                                                      | Engine with formula evaluation, React workbook UI       | **651 KB** wasm                        | Rust. XLSX import/export as a second wasm package merged 2026-08-19 (ironcalc/IronCalc#1363), not on npm yet. No charts                                     |
| `@extend-ai/react-xlsx` 0.16.6 | MIT (engine `@dukelib/sheets-wasm`, MIT)                                              | View and edit, charts, frozen panes                     | 718 KB JS + 1,624 KB wasm = **2.3 MB** | 0.x, one vendor, 20 stars                                                                                                                                   |
| Univer 1.0.2                   | Apache-2.0 core; XLSX import/export is Pro (`@univerjs-pro/exchange-client`, backend) | Full sheet, doc and slide editors                       | not measured                           | Ships an agent CLI and skills with "Git-style diffs, reviews, approvals and rollbacks" for sheets ([dream-num/skills](https://github.com/dream-num/skills)) |
| Glide Data Grid 6.0.3          | MIT                                                                                   | Canvas grid only                                        | 104 KB                                 | Canvas: our tokens, `ListRow` and truncation recovery do not apply inside it                                                                                |
| HyperFormula 3.4, Handsontable | GPL-3.0 or paid; proprietary                                                          | Formula engine; grid                                    | —                                      | Excluded by licence                                                                                                                                         |
| LibreOffice → PDF / CSV        | MPL-2.0                                                                               | Print layout; one CSV per sheet                         | 0 in the browser                       | PDF 822–1,580 ms; CSV for every sheet 448–464 ms. A print layout is not a spreadsheet view (forecast.xlsx became 42 pages)                                  |

## PPTX

| Library                       | Licence | View / edit   | Shipped weight (gz)                  | Notes                                                                         |
| ----------------------------- | ------- | ------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `pptx-preview` 1.0.7          | ISC     | View, HTML    | **421 KB** (bundles ECharts)         | See the screenshot comparison below                                           |
| `pptxtojson` 2.2.0            | MIT     | Parse to JSON | 121 KB                               | We would have to write the renderer                                           |
| `@extend-ai/react-pptx` 0.2.1 | MIT     | View          | 626 KB JS + 218 KB wasm = **844 KB** | 0.x, 6 stars                                                                  |
| `pptxgenjs` 4.0.1             | MIT     | Create only   | 123 KB                               | What Anthropic's pptx skill uses to create decks                              |
| LibreOffice → PDF (server)    | MPL-2.0 | View via PDF  | 0 in the browser                     | 807 ms (14 slides) and 1,615 ms (8.8 MB deck with photos). Output is faithful |

## CSV

CSV is text, and the editor already opens it with a text buffer, undo, save and diffs. What it
lacks is a table presentation.

| Library              | Licence | Role             | Shipped weight (gz) |
| -------------------- | ------- | ---------------- | ------------------- |
| `papaparse` 5.7.0    | MIT     | Parse            | **7 KB**            |
| `VirtualList` (ours) | —       | Rows             | 0                   |
| Glide Data Grid      | MIT     | Canvas grid      | 104 KB              |
| `daff` 1.4.2         | MIT     | Table-aware diff | 0.8 MB unpacked     |

## Screenshot comparison

Headless Chromium (Playwright 1.63) rendered each sample with the browser library, and the result
was compared by eye against LibreOffice's PDF of the same file rasterized at 80–100 dpi.

| File                             | Browser library | Render time | Against LibreOffice                                                                                           |
| -------------------------------- | --------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `demo.docx` (calibre demo)       | `docx-preview`  | 133 ms      | Page 1 matches: fonts, heading rule, first-line indents, bold runs. Page breaks follow the document           |
| `master-services-agreement.docx` | `docx-preview`  | 48 ms       | Matches                                                                                                       |
| `business-review.pptx`           | `pptx-preview`  | 72 ms       | Geometry and colours right; theme fonts (Aleo, Roboto) fall back to Times, so the title wraps differently     |
| `demo.pptx`                      | `pptx-preview`  | 350 ms      | Photo and accent lines right; the top header text boxes are missing; Raleway bold falls back to Times regular |

The PPTX font loss is fixable in principle (register the theme fonts as web fonts), but the missing
text boxes are not ours to fix. LibreOffice drew both decks with the right fonts because fontconfig
had them.

## What the survey says

- **View is solved per format; edit is not.** Every format has a permissive, light, maintained
  viewer path. The only complete browser editors for DOCX and XLSX are AGPL (SuperDoc, ONLYOFFICE),
  Pro-gated (Univer's XLSX exchange), or 0.x single-vendor packages (extend-ai, eigenpal).
- **LibreOffice is the fidelity backstop** for DOCX and PPTX: under a second per file, output as
  good as the source, zero browser weight. It is a per-machine binary, so it cannot be assumed.
- **Extend-ui's engines cost 0.7–2.3 MB gz each** once the runtime wasm is counted. pdf.js costs a
  fifth of EmbedPDF.
