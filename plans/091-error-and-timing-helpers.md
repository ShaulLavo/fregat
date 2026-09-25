# Consolidate error construction, error formatting, and timing helpers

Status: **DONE except one owner question** (completion wave, lane L6, 2026-09-25). Every other unit
landed on `lane/L6`: one `EDEN_STREAM_MISSING` in client-core's transport catalog and a `search`
catalog, one `errorSummary` in contracts (statusCode before status; the server binds
`operatorErrorSummary`), `thrownErrorMessage` for the LSP pool and edit service, the widened
`sanitizeCause` keys, the TUI peel on `rpcErrorPayload`, ingest on the shared sanitizer, the 9.1
comments and the pty guard. Decisions 1–5 took the written recommendations
(Decided 2026-09-25: recommendation (completion wave)).

## Owner questions

- **9.3 — does `createClientError` (`packages/client-core/src/errors.ts`) adopt the
  `instanceof Error` cause routing?** The plan has no recommendation.
  - A, adopt: an Error cause stays on `cause`; anything else (raw Eden envelopes, strings) moves to
    `internal.cause` for all ~59 call sites, both `createRpcError` variants included. Envelopes then
    reach the web log only through client-error-reporting's `errorInternal`, which changes what
    client wide events show under `cause`.
  - B, keep `Object.assign(error, { cause })`: envelopes stay on `cause`, where the diagnostic
    sanitizer walks them; the wrapper gets a comment saying why it differs from the other four.

Delete this file once the question is answered and applied.
