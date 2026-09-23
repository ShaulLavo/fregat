# Staged image and file uploads

Reference pin: `7445aa733ada33e45289e5aa5055f79142556513`.

The composer and optional questions accept image and general-file attachments. Images retain the existing 10 MiB limit and preparation path; files allow 50 MiB, with eight attachments per submission. Upload progress, removal and retry share TanStack mutation state. Ready metadata survives draft reload; blobs awaiting retry stay in IndexedDB. Draft storage excludes inline image bytes and local preview URLs. Failed or incomplete attachments prevent submission.

The server issues an upload reference, accepts an exact-length streamed body, and validates its stored metadata and bytes before command admission. Upload, deletion and command admission share sorted per-attachment lanes. SQLite owns sent uploads: ownership is committed with command events and receipt, after the decision succeeds. A rejected command leaves the upload pending. Metadata stored with ownership lets session deletion find uploads after rewind prunes their message references. Filesystem ownership markers are not used.

The local ticket's 24-hour expiry is the pending object's lifetime. The pinned upstream's ten-minute signed-URL lifetime is a different boundary; these local routes use the application's regular transport and do not issue signed URLs. Unclaimed partial streams expire after one hour. Issuing an upload sweeps expired pending objects.

Codex and Claude receive validated server-local file paths; images retain their native image payloads. Isolated text generation receives the same attachment context and keeps its separate working directory. Transcript file preview and download are documented in `file-preview-delivery.md`.

Focused upload, route and store verification passes 23 tests, including interleaved upload/claim/delete, rejecting replacement before stream consumption, cross-session ownership, exact bytes, incomplete streams, and cleanup without projected message references. Server, web and scripts typechecks pass. Transaction admission and restart tests belong to the engine delivery. The historical live file and enhanced optional-question image/file evidence follows below.

Live release `20260920T151610Z-b915d3e0-plan126-titles-files` passed the file scenario at `/work/tmp/fregat-evidence/20260920T152332Z-scenario-file-attachments` and enhanced question scenario at `/work/tmp/fregat-evidence/20260920T152410Z-scenario-async-questions`. The latter delivered an image plus exact text-file bytes with a running answer, retained both native replies after reload, and dismissed another optional question from a second page. Screenshots were inspected; the final question screenshot caught a brief reconnect notice after assertions. No warning/error server logs were recorded, and fixture settings/session/process cleanup completed.
