# E049: A miss is an error, not a default

Implemented 2026-09-23 in Editor `f715d11`. When the core cannot do what it was asked, the caller
finds out through a type error, a structured error or a `null` it must handle.

- Every optional member on the view, document, capability, edit and plugin contexts is required.
  Test doubles come from the factories in `src/testContexts.ts`, exported as
  `@singapore-editor/core/testing`. Fallback paths that hid a missing host are deleted.
- `bufferRowForRow` returns `number | null`. A mounted row the projection cannot place throws
  `EDITOR_ROW_UNMAPPED`.
- On a buffer session, `setContent` and `applyEdit` go through the session in one undoable
  operation (D1). `setDocument` throws `EDITOR_SET_DOCUMENT_ON_BUFFER_SESSION`. A leased buffer
  throws `EDITOR_BUFFER_LEASED`; a read-only or provisional editor throws `EDITOR_NOT_EDITABLE`.
- Re-entrant view updates are queued and delivered in order (D2). The cap is on the depth of the
  causal chain (32). A contribution that asks more than once along a chain past the cap is reported
  with `EDITOR_VIEW_UPDATE_LOOP` and removed; the others keep receiving updates.
- The positional `setSelection(…, revealOffset)` overload is deleted from core, Solid and React.
- `internal.ts` is deleted. Its consumers moved to `core/document`, `core/extensions`,
  `core/rendering`, `core/debug` and `core/testing`. The secondary text view is the
  `EditorSecondaryTextView` interface.

Validation: one test per buffer-session entry point, re-entrant delivery order, the loop stop,
nullable `bufferRowForRow`, and `public-api.test.ts` pinning that a positional reveal offset does
not compile. The typing, find, completion, hover, fast-scroll and split-view paths never re-enter,
so the hot path gains no pass.
