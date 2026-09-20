# Session titles

LIFE-11 shipped in release `20260920T151610Z-b915d3e0-plan126-titles-files` and passed controlled native browser verification.

Titles record generated/manual provenance and a command version. Initial generation accepts a result only while the original title and version remain current. Manual rename clears pending regeneration and prevents late initial or regeneration results from replacing it. A newer regeneration owns its own completion. Provider failures clear pending state and retain an error for retry; restart clears interrupted requests.

The first prompt uses an application title model, with a project UUID override. Enabled explicit selections remain unchanged; disabled providers fall back to the first enabled default provider in pinned driver order and its default model. Defaults are Codex `gpt-5.6-luna` with low reasoning. Generated provisional titles refine after one completed user turn, once the runtime is ready. Regeneration uses persisted conversation history rather than the bounded client or command read model.

Context selection matches the pinned first-user/recent-user/assistant algorithm, bounded at 8,000 characters with four attachments total. System and reasoning messages are excluded. Validated citation links become plain text. The provider runs an isolated ephemeral conversation through the existing provider service and cleans up its runtime. Images and file references use the attachment store.

Verification:

- Seven real-engine/provider tests cover manual rename, stale request completion, initial generation and refinement, configured model dispatch, restart, empty context, provider failure/retry and disabled-provider fallback.
- Fourteen context/citation tests include 144 executions of the actual pinned context function.
- Nineteen migration tests pass, including replay and restart persistence.
- Server typecheck and changed-file lint pass.

Row/header/bulk title actions now pass 19 focused UI/menu/streaming tests. They show pending/error/retry, preserve failed bulk selections, and wait for canonical shell settlement before the mutation resolves.

Pending: controlled native browser verification, deployment, and comparison of linked-source lookup and text-generation policy overrides. Provider output quality has not been measured.
