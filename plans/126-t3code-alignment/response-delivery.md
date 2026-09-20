# Response delivery — bounded implementation

Reference: t3code `7445aa733ada33e45289e5aa5055f79142556513`,
`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` and settings schema.

The server consumes `chat.responseStreamingMode` (paragraph by default, turn or
token optional) and `chat.projectResponseStreamingModes` by owning project UUID.
The registry entries are application-scoped and read for each delta. There is no
window-controlled execution setting or obsolete streaming/buffered constructor API.

Paragraph buffering uses pinned blank-line, fence and list-item boundaries, first
boundary immediate, later deliveries at least 400 ms apart on the server clock.
There is no flush timer: another delta checks the interval. The 24,000-character
safety valve, final completion and blocking-question boundaries flush remaining
text. Existing command deduplication, runtime epoch checks and native projection
paths remain in use.

Reasoning uses paragraph delivery when token mode is selected. It remains a
`task.progress` activity, with complete untruncated chunks and stable per-segment
identity, rather than introducing upstream reasoning-message commands. Assistant
text, tool starts, blocking questions and completion close the segment; final-only
snapshots are retained and do not duplicate already streamed reasoning. Separate
chunk command/activity IDs protect a final-only snapshot that both spills a
paragraph and flushes its remainder. Existing work-log derivation concatenates
chunks and its Reasoning section exposes the complete text.

Verification:

- 29 focused ingestion tests pass, including default paragraph, 399/400 ms server
  clock boundary, turn mode, overflow, reasoning in all modes, final-only snapshots,
  distinct segments, and duplicate-resistant final-only split commands.
- 61 native Codex adapter tests and 29 ingestion tests pass together: 90 total.
  Exact output: `/work/tmp/plan126-response-delivery-90-tests.log`. This includes
  six native-adapter-to-database reasoning cases, plus token/turn/paragraph native
  projection and final-only paragraph projection.
- 19 work-log tests pass, including complete expanded reasoning retention beyond
  the former 180-character ingestion truncation.
- `scripts/parity/response-delivery.ts`: 248 splitter cases and 190 buffering steps
  execute the pinned splitter/extracted append body; two incorrect splitter controls
  are rejected. CI runs this comparison against its pinned reference checkout.
- Server/web/scripts typechecks and focused lint pass. `response-delivery` browser
  scenario is registered for the final release, with an isolated native fixture,
  expanded reasoning and reload assertions, and settings/session/provider cleanup.

Limits: full RUNTIME-09 conformance remains open. The oracle does not compare cache
lifetimes or the activity representation to upstream reasoning-message persistence.
No claim of identical collapsed reasoning-message UX or a complete cross-provider
live matrix is made. The bounded native browser path is verified below.

Native follow-up: the first live expanded-content check exposed Codex's separate
summary emitter, which bypassed shared ingestion and truncated reasoning. That
cache/emitter is removed. Summary/text deltas now enter shared content ingestion;
completed snapshots retain summary-first fallback and use stable item IDs to
deduplicate repeated completions. Chunks share their block start timestamp and
use ordered IDs because snapshot cursors sort timestamp ties by ID. The real
native-adapter-to-database projection tests exercise 1,282-character content in
paragraph/turn/token modes, final-only summary/content fallback, mixed stream kinds
and index boundaries. All 61 adapter plus 29 ingestion tests pass (90 total).

Initial live evidence: `20260920T160804Z-scenario-response-delivery` required outer
work-group expansion and overlapped a deployment, producing stale-asset 404s.
`20260920T160844Z-scenario-response-delivery` reproduced actual native truncation
with no asset failure. Both owned sessions/providers were removed and all four
native processes exited. The corrected native path passed after final server deployment, as recorded below.

Final live verification passed on web and server release
`20260920T161447Z-b915d3e0-plan126-complete-batch`:
`/work/tmp/fregat-evidence/20260920T161535Z-scenario-response-delivery/`.
Both screenshots were inspected. The expanded Reasoning section shows the first
and last markers with complete text; exact text equality also passes after reload.
The assistant completes with `RESPONSE_DELIVERY_VERIFIED`.

Cleanup removed session `0e34bf31-de47-4e65-affa-70ac8a24f44e` and provider
`verify-e077c962-26ed-4eb0-a403-ec9e4e80e66d`, restored the prior streaming setting,
and confirmed native processes 959214 and 959553 exited. No page errors or asset
failures occurred. The log window contains two unrelated warnings: Git pull-request
state RPC failure and reaping an earlier title-verification session whose provider
was already removed. This is not a claim of a warning-free application.
