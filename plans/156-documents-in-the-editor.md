# Plan 156: Documents in the editor

## Status and authorization

- Status: PLACEHOLDER — far future. The owner wants it; how it works is not known yet, and it needs
  a lot more research. Nothing here authorizes implementation.
- Priority: P4.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Origin: the UI library survey
  ([docs/ui-research/extend-ui.md](../docs/ui-research/extend-ui.md)).

## Outcome

PDF, Word, Excel, PowerPoint and CSV files are first-class documents. They open in editor tabs
with a real rendering, and agents can read them, edit them, create new ones and preview the
result, the way they already work on text files today.

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

## Research needed before any phase exists

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
