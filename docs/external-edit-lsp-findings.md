# External edits and language-server freshness

Verified on 2026-09-21. The question is whether someone can edit an ordinary project in another tool and return to correct source text and diagnostics in Platform.

The ordinary-file check passed, but two broader checks failed. The diagnostic replay fix does not address these failures.

| Check                                                              | Result                                                           | Evidence                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Edit an open, ordinary TypeScript file outside Platform            | Passed on the mesh deployment with TypeScript 6.0.3              | The editor displayed the new identifier and the server published TS2322 for the newly invalid assignment. The initial publication had no errors.                                                                               |
| Edit an unopened imported source file                              | Passed through Platform's actual LSP proxy with TypeScript 6.0.3 | Diagnostics cleared after a normal write, returned after atomic replacement, changed to TS2307 after deletion, and cleared after recreation. No LSP document-change messages or project reloads were sent for that dependency. |
| Edit an unopened imported source file with native TypeScript 7.0.2 | Failed through Platform's actual LSP proxy                       | After the initial diagnostic was confirmed, changing the dependency produced no diagnostic-refresh notification within 20 seconds.                                                                                             |
| Edit an open file through a symlinked folder                       | Failed on both mesh and the local development app                | Disk contents changed, but the editor retained the removed line beyond the scenario's five-second deadline. Later atomic-write and conflict phases were not reached.                                                           |

## Retained evidence

- Production symlink scenario: `/work/tmp/fregat-evidence/20260921T160808Z-scenario-editor-external-edit/`.
- Local symlink scenario: `/work/tmp/fregat-evidence/20260921T160918Z-scenario-editor-external-edit/`.
- The standalone integration-test reproduction for both TypeScript versions is saved at `/work/tmp/fregat-evidence/20260921-external-lsp-audit/typescript-server.test.ts`. It extends `apps/server/src/lsp/tests/typescript-server.test.ts`; its relative imports assume that location. The failing audit was not left in the normal test suite.
- The ordinary-file probe opened a disposable project on the mesh deployment, waited for an empty diagnostic publication, then wrote `export const EXTERNAL_CHANGED: number = "wrong";` to disk. The editor displayed that text and the connection received TS2322. The temporary project was removed afterward.
- Production watch logs identify the running server as `20260921T103639Z-2bdc8b52-main`. The current-release symlink alone does not identify the running process.
- Both app doctor checks passed afterward. The local failed scenario also recorded a terminal React error, separate from the file-refresh assertion. No watch error explained the missing symlink update.

## Required follow-up

1. Implement and test language-server file-watching support. The proxy currently acknowledges capability registrations without implementing filesystem watches. The client also does not advertise `workspace.didChangeWatchedFiles` registration support. Verify the installed native TypeScript version's requirements before choosing the integration.
2. Deliver create, change, delete, and atomic-replacement events for unopened dependencies and configuration files. A file visible in the editor has a separate document-sync path; passing that test cannot prove that unopened dependencies update.
3. Trace the symlink failure from the native watcher through the event stream to document reconciliation. Add missing delivery and reconciliation fields to the existing operation logs before changing behavior. Preserve dirty buffers and surface conflicts.
4. Verify return-from-background and reconnect behavior. Resynchronize source documents and request current diagnostics when continuity of filesystem events cannot be established. Replaying an earlier result is useful, but it cannot establish freshness after a gap.
5. Repeat the matrix with both supported TypeScript runtimes. Include configuration edits, package installation, branch switches, and edits while disconnected before making a broad production-readiness claim.

The native TypeScript source describes a built-in watcher fallback only for certain platforms when client watcher registration is unavailable. See [TypeScript's LSP server](https://github.com/microsoft/typescript-go/blob/main/internal/lsp/server.go). The behavioral failure above was measured against the installed version, rather than inferred from upstream source.

Resolved by Plan 134 (2026-09-24 and 25); see [Resolution](#resolution).

The immediate concern is therefore broader than Platform opening its own repository. Ordinary external editing works in the tested case, while linked paths and native TypeScript dependency refresh still need work.

## Resolution

Plan 134 closed this on 2026-09-25. What each failure turned out to be, and what now holds:

| Failure                                     | Cause                                                                                                                                                                                                                               | Now                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Symlinked open file kept its old text       | The open-file stream waited for the project watcher, and parcel ran every subscribe behind any crawl in the process (8–22 s with three roots open). Parcel also dropped writes in new, moved-in, renamed and recreated directories. | Open files have their own watches. Parcel is gone: Bun's recursive `fs.watch` attaches in 0.1–0.3 s and keeps all of those writes.                            |
| TypeScript 7 never refreshed                | 7.0.2 has no watcher on Linux; the proxy acknowledged its watch registrations and did nothing.                                                                                                                                      | `apps/server/src/lsp/watched-files.ts` implements them at the pooled backend.                                                                                 |
| Linked declarations went stale              | 7.0.2 names the common ancestor of files outside the project and, after a rebuild deletes them, waits for them through the link in `node_modules`.                                                                                  | The registry watches the real targets of directories linked into the project and reports a change at both the real path and the link.                         |
| Edits made during a gap were lost           | Event streams never reopened, and a read that an event asked for could fail offline.                                                                                                                                                | Streams reopen with backoff; every new stream and every return online resyncs open files (a dirty one only conflicts if its disk version moved) and the tree. |
| A dead language server stayed dead          | The browser retired the connection on the first loss.                                                                                                                                                                               | `@singapore-editor/lsp-plugin` reconnects with `reconnect.delaysMs`; the "stopped" toast appears only when that gives up.                                     |
| An empty Problems panel could mean anything | A cleared or pending result looked like a clean one.                                                                                                                                                                                | Every diagnostic summary carries `freshness`.                                                                                                                 |

Decisions that hold the design together:

- Watches are bounded, not literal. A `node_modules` base is watched one level deep, as VS Code's default exclude does. An ancestor of the project is clamped to the project plus its linked targets, never the whole drive.
- A rename over an existing file arrives as `created`, and 7.0.2 ignores Created for a file it already has. Files are sent as Deleted then Created. Directories are sent as Created only: after a Deleted, 7.0.2 treats a directory as gone.
- Registration replies wait until the watch is attached. Registrations that cannot be honoured get an error reply, not an acknowledgement.

Limits and traps found on the way:

- 7.0.2 reports an unused local as a suggestion even under `noUnusedLocals`, so the lever for a configuration test is `noImplicitAny`.
- Chromium's offline emulation does not drop a localhost SSE stream. The deployment is where a real drop happens.
- `curl … | head -1` returns on the second event, not the first. It produced false readiness timings early on.

Verification lives in `apps/server/src/lsp/tests/typescript-server.test.ts` (both runtimes: external edits, linked packages, configuration, installs, branch switches) and the scenarios `editor-external-edit`, `editor-external-diagnostics`, `editor-linked-package`, `editor-offline-resync` and `editor-lsp-server-exit`.
