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

Follow-up on 2026-09-24 (Plan 134): the symlink failure was the files stream waiting on the project watcher behind parcel's serialized crawls, and TypeScript 7 needed client file watching. Both are fixed; the plan's Progress section has the causes and what remains.

The immediate concern is therefore broader than Platform opening its own repository. Ordinary external editing works in the tested case, while linked paths and native TypeScript dependency refresh still need work.
