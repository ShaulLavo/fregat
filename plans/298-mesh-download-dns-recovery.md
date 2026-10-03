# Plan 298: Survive intermittent DNS during release discovery

Status: APPROVED.

Implementation owner: [ShaulLavo/mesh](https://github.com/ShaulLavo/mesh). Reported in [Mesh #98](https://github.com/ShaulLavo/mesh/issues/98), including its [later DNS timing evidence](https://github.com/ShaulLavo/mesh/issues/98#issuecomment-5959080882).

## Outcome

A temporary DNS stall can recover during release discovery within a bounded total budget. A failed update names the slow network phase and the retry outcome. Cancellation remains prompt, and the update retains one approved release identity.

## Evidence and source

The first report suggested a Go resolver difference. Its later comment rules out that narrow diagnosis. Three curl runs took 0.77, 5.4, and 20.7 seconds, mostly in DNS. The cgo path also failed, then recovered. The Pi's intermittent MagicDNS stalls are confirmed observations. Their underlying network cause remains unconfirmed.

At Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, `internal/cli/update.go` gives `UpdateRelease.Manifest` a five-second context. `internal/release/client.go` defaults its HTTP client to thirty seconds, so the outer context wins. `Manifest` also performs latest-tag discovery and redirected manifest download within the caller's context. Errors identify manifest download but do not expose DNS versus dial timing.

Start in those files and `internal/release/client_test.go`. Inspect `internal/bootstrap/release.go` and the other release-client callers before changing a shared retry policy. Follow [T26 release pinning and verified downloads](https://github.com/ShaulLavo/mesh/blob/main/docs/tasks/T26-mesh-updates.md).

## Budget and ownership

The update command owns one total discovery deadline. All DNS, dial, redirect, response, and retry waits consume that budget. The release client owns a bounded retry policy for transient idempotent metadata fetches. Use the existing thirty-second release-client budget as the initial command cap, subject to the caller's shorter cancellation deadline. Record measured results before accepting a larger cap. Do not reset the total deadline on each attempt.

Retry transient lookup/connect timeouts with bounded backoff while budget remains. Keep manifest validation, checksum errors, permanent HTTP errors, and caller cancellation terminal. Resolve `latest` to one exact version once obtained. Retries and subsequent artifact requests use that version. Preserve HTTPS checks, payload limits, verified caches, and cleanup of incomplete files.

Use `httptrace` or equivalent existing client instrumentation to attribute completed and stalled DNS, connect, TLS, response, and body phases across redirects. A final error reports the last observed phase, elapsed time, and attempt count. State an unknown phase honestly when an injected transport cannot supply timing. Never include credentials or response payloads in operation diagnostics.

Do not force `GODEBUG=netdns=cgo`, rewrite the host resolver, switch to IPv4 globally, or append a trailing dot without a demonstrated need. Network repair on the Pi is a separate diagnosis if stalls persist after Mesh handles them.

## Execution checklist

- [ ] Capture a bounded known-good metadata fetch and reproduce delayed DNS through an injected resolver/dialer. Separate DNS, redirected DNS, connection, TLS, and body-delay cases. Use the original Pi timings as evidence, not a deterministic test dependency.
- [ ] Audit deadline ownership for CLI, bootstrap, coordinator, and background notices. Define the total budget in the existing release policy. Avoid new environment controls or host-specific settings.
- [ ] Add network phase evidence first and prove it attributes a DNS delay correctly. Include redirects and a reused connection. Keep progress on stderr and JSON results parseable.
- [ ] Add bounded retries only for the demonstrated transient metadata failure classes. Prove an early stall can recover, an exhausted budget stops, and cancellation interrupts backoff and in-flight requests.
- [ ] Verify release pinning, manifest validation, and archive verification still hold. Confirm an invalid manifest or permanent response is not repeatedly fetched.
- [ ] Run the focused release and update CLI tests, then required Mesh checks. Capture one bounded live Pi metadata check with the installed patch and compare its phase diagnostics to a curl timing observation if a natural stall occurs.
- [ ] Commit, push, pass CI, publish a patch release, and verify the installed executing build. Record any remaining host DNS problem as separate evidence without claiming a resolver fix.

## Acceptance and verification

Deterministic fixtures use a local TLS server and injectable lookup, dial, clock, and wait behavior where needed. No committed test requires Tailscale, GitHub uptime, the Pi, or a wall-clock twenty-second sleep. Measure total deadline use and cancellation, rather than merely counting retries.

Run `go test -race ./internal/release ./internal/cli ./internal/bootstrap` for affected paths, followed by `go mod tidy -diff`, `go vet ./...`, `go test -race ./...`, and `./scripts/verify.sh`. A live account check is a one-off proof kept in the evidence directory.

The same command recovers from a transient lookup delay when budget remains. Persistent stalls fail within the total cap and name DNS when observed. Redirect handling remains secure. Retries cannot change the approved release, create an unbounded loop, or publish a partly verified executable.

Apply `how` to deadline ownership, `principle-make-operations-idempotent` to fetch retries, and `unslop` to errors. Baseline and comparison evidence determine any further performance or timeout change.
