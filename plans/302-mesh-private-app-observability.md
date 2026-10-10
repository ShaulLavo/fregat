# Plan 302: Show private-app output and accurate startup results

Status: Approved. Follow the existing temporary-app delivery order. Coordinate ownership changes with [Plan 291's public-hosting retirement](291-mesh-private-services.md).

Implementation owner: [ShaulLavo/mesh](https://github.com/ShaulLavo/mesh). Reported in [Mesh #55](https://github.com/ShaulLavo/mesh/issues/55), plus the remaining URL diagnostic from [Mesh #103](https://github.com/ShaulLavo/mesh/issues/103).

## Outcome

Give Mesh a folder and an explicit command, then receive an app ID, URL, and accurate runtime state. A failed setup or startup names its step and exposes owner-authorized output by app ID. Human progress stays useful and JSON stays parseable. A URL lookup problem appears separately from the app's runtime readiness.

## Evidence and existing work

#55 already approved app logs, creation/update progress, and ready/failed/starting results after the current audit. Preserve the folder-plus-command workflow and its existing order. Git integration and a hosting dashboard remain outside this plan.

#103's original missing DNS record was fixed live. Its [October 2 completion comment](https://github.com/ShaulLavo/mesh/issues/103#issuecomment-5958608993) records the owner-approved wildcard and a newly created app opening over HTTPS. Preserve that shipped evidence without repeating the DNS repair. Plan 291 determines the surviving private URL after public hostnames are removed. The remaining request is an actionable warning when the URL actually returned to the owner cannot resolve.

At Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, `internal/cli/app.go` has create/update/inspect and JSON output, but no app-specific logs command. `internal/apps/types.go` contains `Record.Ready`, `RuntimeInfo`, and retained `SetupFailure`. `internal/apps/origin.go` already keeps bounded failed setup output and app-worker references. Reuse these before adding storage. `internal/cli/app_transport.go` owns authenticated owner access and uploads.

Follow the [temporary-app plan](https://github.com/ShaulLavo/mesh/blob/main/docs/plan/06-temporary-apps.md), [T29's implemented lifecycle](https://github.com/ShaulLavo/mesh/blob/main/docs/tasks/T29-temporary-apps.md), and [temporary-app commands](https://github.com/ShaulLavo/mesh/blob/main/docs/temporary-apps.md). Plan 291 removes all Mesh public hosting while retaining private apps and dormant generic pill source. Mesh does not inject the pill or provide sharing controls. This plan preserves setup/runtime inspection and expiry cleanup through that change.

## State and output ownership

The origin owns setup, worker state, readiness, and retained output. The private registry owns routing and app access. The caller owns its own DNS reachability observation. Keep these facts separate. Allocating a name or publishing a route never means the runtime is ready.

Extend the existing app result with one current phase and optional failed-step/error information. Creation and update results use the same phase projection as `inspect`. Ready requires the current serving check, starting means readiness remains pending, and failed means setup/startup finished unsuccessfully. Preserve working app state when a staged update fails, while reporting that update's failure separately.

Add `mesh app logs HOST ID` following the existing host-qualified CLI family. Read setup and runtime output through the existing owner authorization. The result identifies app, operation/revision, phase, and output source. A failed create still returns an app ID or retained failure identifier that the printed logs command can resolve. Reuse bounded worker scrollback and `SetupFailure` retention. Define a bounded snapshot as the first delivery. Add follow mode only if the existing stream can support cancellation and expiry without creating another log store.

Keep retained output under the app lifecycle. Preserve failed-start diagnostics for the existing failure-retention interval, including a setup failure whose workspace was cleaned. Expiry and deletion remove app payload/output according to the existing contract. A logs request checks current owner and lifetime before exposing content. Unauthenticated browsers and other identities cannot retrieve it. Avoid commands, environment values, and output tails in caller-visible errors or routine operation logs.

Report progress for copying, explicit setup, starting, and ready. Use stderr for human progress and valid final JSON on stdout. Machine results identify the same phase and failed step. Setup/startup failure exits nonzero after writing a parseable structured result. Starting stays an explicit pending result with inspect/logs commands. Bound progress events and avoid polling noise.

After creation returns an app, perform a bounded caller-side DNS check of its actual surviving private URL, using Plan 291's URL contract. A missing record or lookup timeout reports URL reachability as a separate warning with the observed reason and retry/inspection instruction. It does not erase the created app or set runtime `ready` from DNS. Add the same distinction to JSON. Do not modify DNS, issue certificates, or expose the private app while diagnosing the URL.

## Execution checklist

- [ ] Reproduce successful static/server creation, failed setup, early runtime exit, and still-starting state with disposable app directories. Compare current `create`, `update`, and `inspect` results to actual worker state and retained output.
- [ ] Define one result projection from existing origin/registry facts. Separate failed candidate updates from a still-working prior revision. Identify the ID or failure token needed to inspect a failed create.
- [ ] Add owner-authorized `app logs HOST ID` using current worker output and retained setup failure. Cover setup and runtime output, failed start, owner denial, retention expiry, and deletion. Bound responses and sanitize terminal control sequences in human output without altering stored raw evidence.
- [ ] Add operation progress through the existing authenticated app request flow. Preserve retry IDs so reconnecting observers cannot duplicate an app or setup command. Keep stderr progress separate from final stdout JSON.
- [ ] Make create/update exit status match setup/startup outcome. Supply app ID, URL, phase, failed step, and copyable inspect/logs commands for human results. Keep starting distinguishable from ready and failure.
- [ ] Add the caller-side URL lookup warning with an injectable resolver and bounded cancellation. Prove a working runtime can report a DNS warning, and a resolving hostname cannot mark a failed runtime ready. Check Plan 291's surviving private URL. Retain #103's historical DNS repair evidence without requiring its retired public hostname scheme.
- [ ] Run focused app lifecycle, transport, CLI, and authorization tests. Verify the real private workflow from another approved device and inspect the returned progress, JSON, failure output, and URL result.
- [ ] Complete Mesh gates, commit and push, pass CI, publish a patch release, and verify the installed commands. Record evidence before deleting only the disposable apps and their owned files.

## Acceptance and verification

Successful creation reports the ID, URL, and observed startup phase. A failed explicit setup or server that exits before readiness returns a nonzero status, names the step, and exposes its output through the printed app-specific command. Still-starting apps can be inspected without a false ready result. A failed staged update identifies its candidate failure while the old app remains accurately represented.

Human progress and JSON identify the same outcome. JSON parses without stripping progress. Only the owner can read app output. Logs stop being available according to the app's retention and cleanup contract. URL lookup failures warn with caller-side evidence and leave origin readiness accurate.

Use real temporary app state and the current outside-world adapter seams. Committed tests require neither the owner's DNS zone nor live GitHub/Tailscale. Run affected `internal/apps`, `internal/cli`, and daemon tests first, then `go mod tidy -diff`, `go vet ./...`, `go test -race ./...`, and `./scripts/verify.sh`. Browser private-access checks run only in an available supported environment with an explicit skip otherwise. Keep live DNS/private-browser proof as one-off evidence.

Apply `how` to app lifecycle and transport, `principle-make-operations-idempotent` to observation after reconnect, and `principle-sequence-verifiable-units` to state results, logs, progress, and DNS diagnostics. Apply `unslop` to all commands and errors.
