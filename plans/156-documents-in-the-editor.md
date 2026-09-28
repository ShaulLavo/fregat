# Plan 156: Documents in the editor

## Status and authorization

- Status: wave 2 P0–P2 remaining, reconciled 2026-09-28. Research and owner direction are
  recorded below. Later format/editing phases remain follow-up work under their stated gates;
  this planning update does not authorize implementation.
- Priority: wave 2 closeout for P0–P2; later phases follow format readiness.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Origin: the UI library survey
  ([docs/ui-research/extend-ui.md](../docs/ui-research/extend-ui.md)).

## Outcome

PDF, Word, Excel, PowerPoint and CSV files are first-class documents. They open in editor tabs
with a real rendering, and agents can read them, edit them, create new ones and preview the
result, the way they already work on text files today.

## Current implementation and dependencies (2026-09-28)

The source audit found no production web consumer of `seemsBinary` and no installed PDF/Office
viewer integration in the web app. P0–P2 remain implementation work. The measurements below are
2026-09-25 research results, not refreshed dependency recommendations or current bundle budgets.
Recheck versions, licences and representative files before selecting an engine.

Use existing file-document identity. Plan 200 owns shared content-source ownership, 198 owns
retained analysis and attachment, and 099 owns buffer publication/consumer synchronization.
Their full completion is not required for the binary guard or a view-only PDF tab. CSV keeps the
existing live text buffer and must reuse whichever publication contract has landed. Do not create
another retained-document registry or synchronization service while those plans proceed.

Follow Plan 179's isolation policy: PDF scripting disabled, DOCX-generated styles/ids in a shadow
root, active HTML in an opaque-origin sandbox. Shared chat/file previews use the same format
viewer. Historical projection diffs read immutable blobs and preserve the partial/complete source
contract from 099; never substitute current disk text for a historical side.

The owner's optional-LibreOffice decision requires a browser viewer for every supported format.
The old PPTX-only-through-LibreOffice phase did not meet it. Browser PPTX fidelity is an explicit
research gate before that format ships. XLSX editing is a separate phase after viewer delivery.
DOCX editing follows completion of the required Markdown authoring behavior; its proposed round trip must expose fidelity
loss and preserve the original until the user accepts the result.

## What we know so far

- **extend-ui** (MIT, `references/extend-ui`) ships viewers and editors for PDF, DOCX, XLSX, PPTX and
  CSV as a shadcn registry on Base UI and Tailwind v4, the same stack as ours. Their engines are
  heavy: EmbedPDF (PDFium wasm, ~5 MB), `@extend-ai/react-docx` 12.8 MB, `react-xlsx` 19.4 MB,
  `react-pptx` 10.1 MB, and Glide's canvas data grid for CSV at 3.7 MB (sizes as installed, not
  as shipped). The survey's view: only the PDF viewer is plausible as-is.
- It also has ideas worth keeping: a keep-alive pool for expensive viewers (the 4 most recent stay
  mounted and are reparented, not reloaded), a thumbnail rail, OCR layout overlays and citations
  that point into a page.
- Our editor is text-first (`@singapore-editor/*`). Documents are a different kind of tab. The
  document-contribution work ([Plan 099](099-document-contributions.md)) and `lib/keep-alive` are
  the likely seams.

## Research questions answered by the findings below

1. **Survey the libraries.** extend-ui is one; more is needed for each format. Check rendering
   fidelity, bundle and wasm weight, licence, and whether each can edit or only view.
2. **Agent editing model.** Can agents change a binary format directly, or do they edit a text
   form (Markdown or HTML for DOCX, CSV or JSON for XLSX) that is converted back? How are their
   changes reviewed and undone? Plans 139 and 136 cover that for text and files.
3. **Create and preview.** How an agent creates a new document, and how the user previews it
   before accepting it.
4. **Where it runs.** Browser workers or wasm, the server, or both. Consider remote machines too.
5. **Tab model.** How a document tab sits beside text tabs, diffs and the keep-alive rules.

## Open questions

- Which formats come first?
- View-only first, or editing from the start?
- Does document preview in the chat (attachments, agent output) share the same viewers?

## Research findings (2026-09-25)

Read from `origin/main` at `9f343825`; no open PR branch changes this plan. The full library
survey, with method and screenshots, is [docs/documents/library-survey.md](../docs/documents/library-survey.md).
Probes ran under `/work/tmp/research/156/`.

### What happens today

- Opening a PDF, DOCX, XLSX or PPTX opens it as text. `/fs/read` decodes any bytes and reports
  `seemsBinary` and `lossy` (`apps/server/src/fs/read.ts:48-59`); nothing in `apps/web` reads
  `seemsBinary`, so the tab shows mojibake and a save is refused with `LOSSY_WRITE_BLOCKED`.
- A binary file in a Git or checkpoint diff shows only a notice (`isBinaryDiff`,
  `apps/web/src/features/git/utils/diff-presentation.ts:44`). Diffs run with `--no-textconv`
  (`apps/server/src/git/service.ts:324`).
- Chat attachment preview is text only (`features/chat/components/chat-file-preview.tsx`).
- Bytes already reach the browser: `GET /fs/blob` streams the whole file with a content type and
  version headers (`apps/server/src/fs/routes.ts:45`, `fileResponse` at `:161`). It has no Range
  support.

### 1. Library survey

Shipped weight is esbuild-minified JS plus runtime wasm, gzip -9.

| Format | View first                                | Weight (gz)      | Fidelity backstop                              | In-app edit                                                                                                  |
| ------ | ----------------------------------------- | ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| PDF    | `pdfjs-dist` core API, our own chrome     | 493 KB           | Is the backstop                                | pdf.js annotation layer, or EmbedPDF (2.3 MB, MIT) if forms, redaction or signing are ever wanted            |
| CSV    | Table presentation of the text buffer     | 7 KB (papaparse) | —                                              | Already editable as text                                                                                     |
| DOCX   | `docx-preview` (Apache-2.0)               | 50 KB            | LibreOffice → PDF, 0.74–0.79 s                 | Nothing permissive and mature. SuperDoc is AGPL (3.4 MB); extend-ai and eigenpal are 0.x                     |
| XLSX   | SheetJS CE (Apache-2.0) into our own grid | 138 KB           | LibreOffice → PDF is print layout, not a sheet | IronCalc (MIT/Apache-2.0, 651 KB wasm, formula engine) is the one candidate; its XLSX wasm is not on npm yet |
| PPTX   | LibreOffice → PDF → the PDF viewer        | 0 in the browser | Is the backstop, 0.8–1.6 s                     | None. Browser renderers drop theme fonts and text boxes (`pptx-preview` screenshots)                         |

- Extend-ui's engines are 0.7–2.3 MB gz each once their wasm is counted, and all are 0.x from one
  vendor with 6–23 GitHub stars. EmbedPDF is the exception: 4.5k stars, MIT, pushed daily.
- `docx-preview` matched LibreOffice's page 1 on the calibre demo in 133 ms. `pptx-preview`
  lost theme fonts on both decks and dropped the header text boxes of one.

### 2. Agent editing model

- **Agents already edit the real binary.** Claude runs with Anthropic's document skills, which
  work on the file itself: DOCX edits are `unzip` → edit `word/document.xml` → `zip`, with tracked
  changes as `w:ins`/`w:del`; XLSX edits use openpyxl then a LibreOffice recalc; decks are made with
  pptxgenjs; and every skill verifies its output by rendering it (`soffice --convert-to pdf`, then
  `pdftoppm`). See the docx, xlsx and pptx `SKILL.md` files under
  `~/.agents/skills/synced/…/{docx,xlsx,pptx}/`. Claude Code's Read tool reads PDFs natively. Codex
  now has the shared document skills available through `~/.agents/skills`, as does Claude.
  The earlier claim that Codex had no document skills is obsolete. Verify actual CLI/session
  skill availability when proving the agent workflow; availability in this audit does not prove
  every provider session loads the skills.
- **Editing a text form and converting back loses the document.** Mammoth drops styling by design,
  and Markdown has no headers, footers, section layout, comments or tracked changes. A round trip
  through Markdown would wipe all of those on the first agent edit.
- **Recommendation: agents edit the file; Platform uses text forms only to read and review.**
  Platform does not need an agent-facing edit API.
- **Review is a projection diff.** Project each side of a diff to canonical text and feed the
  existing diff editor:
  - DOCX → Markdown through mammoth;
  - XLSX → one line per cell, `Sheet!A1 <tab> =formula <tab> shown value`;
  - PPTX → text per slide;
  - PDF → `pdftotext`.

  Probe: one edited run in `master-services-agreement.docx` produced exactly one changed line
  (24–42 ms per side). `forecast.xlsx` projected 3,807 cells across 15 sheets in 38 ms. A
  "compare pages" view (old and new rendered side by side) covers layout-only changes, which a
  projection cannot show.

- **Undo is per file, never per hunk.** Checkpoints already capture binaries
  (`git add --all`, `apps/server/src/git/checkpoint-store.ts:126`), and whole-turn revert restores
  them. Plan 139's per-file undo must restore the blob from the turn's base ref
  (`git restore --source <ref> -- <path>`). Reverse-applying a patch cannot work here: `diffRefs`
  emits no `--binary` patch. `restoreRef` restores `.`, the whole tree (`git/service.ts:353-373`).
- **In-app edits of binary files need a byte write.** The workspace-edit journal's `write`
  operation carries `text: v.string()` (`apps/server/src/fs/contracts.ts:273-279`). CSV table edits
  avoid this because they stay text edits on the buffer.

### 3. Create and preview

- **Creating a document is the agent's job.** It uses docx-js, pptxgenjs, openpyxl or reportlab,
  and writes into the worktree like any other file. Platform needs no create API.
- **Preview is opening the file.** The new file appears in the turn's files. Opening it opens a
  document tab. Keeping the file needs no action. Rejecting it is Plan 139's per-file undo.
- **Turn-file rows can show page thumbnails.** Page 1 at 100 dpi took 42–175 ms from a PDF. For
  Office files, the LibreOffice conversion comes first and costs 0.74–1.6 s.
- **Recommendation: chat attachments and agent-output links open the same viewers** as the editor
  tabs. `chat-file-preview.tsx` becomes a consumer.

### 4. Where it runs

- **Browser, for every viewer.** pdf.js keeps parsing in its own worker; docx-preview, SheetJS and
  papaparse are small enough for the main thread and can move to a worker if a trace says so. This
  works for remote machines unchanged, because bytes come over each machine's `/fs/blob`. Each
  format is its own lazy chunk (the Plan 129 shape).
- **Server, on the machine that holds the file, for conversions and projections.**
  - Projections run in Bun with the same JS libraries (mammoth, SheetJS) and Poppler's
    `pdftotext`. They need no LibreOffice.
  - LibreOffice is needed only for PPTX, faithful DOCX pages, and thumbnails. Measured cost:
    0.74–1.6 s per file with one process per call, and 1.19 s the first time a profile is created.
- **LibreOffice is a per-machine capability, never an assumption.** This machine has 26.2.5.2;
  the Mac rig is not known to. Probe it the way provider binaries are resolved (`Bun.which`), and
  when it is missing, say so in the tab and fall back to the browser viewer.
- **Not ONLYOFFICE or Collabora.** Both are server containers idling at 0.5–1.3 GB of RAM, and
  ONLYOFFICE is AGPL.

### 5. Tab model

- A document is an ordinary `file` document ref: same key, same tab, same rename handling
  (`docs/document-and-tab-domain.md`). Only the body differs. The branch goes in
  `features/workbench/components/editor-surface-tab-body.tsx` beside the search branch
  (`:221`): pick a viewer by extension and `seemsBinary`, and do not create a text buffer. A viewer
  has no dirty state.
- CSV keeps its text document. A second presentation (table) toggles per tab. The text buffer stays
  the source of truth, so undo, save, LSP and diffs keep working.
- **No keep-alive for viewers at first.** Hold the bytes in a TanStack query keyed on path and
  `x-fs-version`; a re-render is cheap (docx-preview: 48–133 ms). `lib/keep-alive` exists for
  content whose unmount loses state, such as a PTY. If reopening a large PDF shows up in a trace,
  adopt extend-ui's small LRU of parked viewers then.
- Git and checkpoint diff tabs of a document file show the projection diff, with a toggle to
  compare pages.

### Recommendations on the open questions

- **Which formats first. Recommendation:** PDF view and the CSV table first. They cost 493 KB and
  7 KB and need no server dependency. Next, projection diffs, which make agent edits reviewable.
  Then DOCX and XLSX view, and PPTX last through LibreOffice.
- **View-only or editing. Recommendation:** view-only in the app. Agents do the editing, and the
  user reviews it through projection diffs and per-file undo. CSV is the exception: it is already
  editable.
- **Shared chat preview. Recommendation:** yes, with one viewer per format.

### Owner questions

1. **Licences.** The only complete DOCX editor in the browser (SuperDoc) and the best OOXML server
   (ONLYOFFICE) are AGPL. Platform is a public repo with no licence.
   - (a) Permissive dependencies only. **Recommended.**
   - (b) Allow AGPL for an optional document editor.
   - Decided 2026-09-26: owner — (a) permissive only, and as few dependencies as possible. A licence
     audit of what already ships runs first (`/work/reports/next-wave/dependency-licences.md`).
2. **LibreOffice.**
   - (a) An optional per-machine capability with a browser fallback. **Recommended.**
   - (b) Required on every machine.
   - (c) Never used.
   - Decided 2026-09-26: owner — (a): optional per machine, browser-first; every document stays viewable in the browser without it.
3. **In-app editing beyond CSV, ever?**
   - (a) No; agents edit. **Recommended for now.**
   - (b) XLSX cell editing after an IronCalc spike, once its XLSX wasm ships on npm.
   - (c) DOCX WYSIWYG, which today means AGPL or a 0.x package.
   - Decided 2026-09-26: owner — yes: XLSX cell editing (b), then DOCX later (c).
   - Amended 2026-09-26: owner — DOCX editing is parked until the markdown work (Plans 176 and 108)
     settles. The direction is DOCX converted to and from a markdown-like source edited in our own
     editor; no WYSIWYG dependency.
4. **PDF engine.**
   - (a) pdf.js, 493 KB. **Recommended.**
   - (b) EmbedPDF, 2.3 MB, for annotation, forms, redaction and signing, which nothing on the
     roadmap needs.
   - Decided 2026-09-26: recommendation (owner deferred) — (a) pdf.js.

### Execution phases

Wave 2 closes P0–P2, following 132, 179, 099 and 114 in the closeout queue, with 126 split by
remaining batch. These are scheduling preferences, not dependencies on every phase of those
plans. P3 onward stays the documented follow-up scope; DOCX editing retains its owner gate.

0. **Binary files stop opening as text.** Honour `seemsBinary`: show a file-facts body (size,
   type, reveal) and no text buffer.
1. **PDF viewer.** pdf.js core in a lazy chunk, pages in measured flow, text layer and search.
   Chat attachment preview uses it.
2. **CSV table view** over the text buffer: papaparse and `VirtualList`. Edits in the table become
   buffer edits.
3. **Projection diffs** for DOCX, XLSX and PDF in Git and checkpoint diffs, computed on the server.
   Add a blob-restore per-file undo to Plan 139.
4. **DOCX and XLSX viewers:** docx-preview, and SheetJS into our grid. Both are lazy.
5. **PPTX browser gate and optional conversion:** prove a permissively licensed browser fallback
   on the representative decks before choosing its engine or declaring PPTX supported. Record
   missing layout, fonts and objects visibly. LibreOffice may add faithful pages, DOCX page view
   and turn-file thumbnails when available on the owning machine. Test with LibreOffice absent;
   conversion cannot be the only way to view a supported document. If no candidate meets the
   browser requirement, keep this phase blocked on that finding and obtain a scope decision.
6. **XLSX cell editing:** spike IronCalc's current XLSX support and distribution, or document a
   replacement candidate. Prove formula preservation/recalculation and safe byte writes through
   the existing filesystem transaction owner before exposing editing. Preserve untouched sheets,
   detect external changes and verify whole-file undo. A grid editor alone does not close this phase.
7. **DOCX source editing, parked:** after Plans 176 and 108 settle, evaluate the owner's
   Markdown-like source direction using our editor. Define the supported subset, loss reporting,
   original-file retention and explicit acceptance of a lossy export. Do not add a WYSIWYG
   dependency or promise a lossless Markdown round trip.

Each delivered format needs an actual open/preview scenario, read-back screenshots, remote-file
ownership checks and the relevant unavailable-engine/error cases. P3 additionally proves review
and whole-file restore against binary checkpoint blobs. This refresh ran no format/browser tests.
