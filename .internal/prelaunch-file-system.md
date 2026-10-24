> [!NOTE]
> **STATUS: 🔵 TOUCH-UP ONLY (reviewed 2026-06-06).** Pre-launch guardrails still accurate (`FS_DEV_MAX_TEXT_FILE_BYTES` exists in `apps/server/src/index.ts`).

# Pre-Launch File System Requirements

The local development server can still browse `/` when the user explicitly picks
Root in the file picker. It must not open there automatically.

Before any native, packaged, or remote distribution:

- Require native/bootstrap session auth for every `/fs/*` and `/lsp/*` route.
  Origin-only auth is dev-only; the bootstrap credential is milestone M4 in
  `plans/environments-and-remote-plan.md`.
- Replace whole-file text reads with metadata-first open, chunked text reads,
  editor chunk loading, and a clear too-large-to-open-as-text state.
- Lower or remove `FS_DEV_MAX_TEXT_FILE_BYTES`. The current 200 MB default exists
  only to keep development unblocked while chunking is being built.
