# Plan 295: Collect one issue report across the owner's projects

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: Fregat owns the API/script collector and report contract. Mesh owns recurring execution through Plans [293](293-mesh-durable-job-state.md) and [294](294-mesh-job-coordination.md).
- Reported in: [Mesh #106](https://github.com/ShaulLavo/mesh/issues/106), with scope recorded in [the first triage report](issue-triage-2026-10-02.md).
- Order: Ship a usable manual collector first. Add durable recurring registration after scheduler prerequisites pass.

## Outcome

The owner opens one remotely reachable report for the selected repositories. It lists every open issue, its original link, implementation owner, and changes since the last acknowledged review. Collection consumes ordinary GitHub API requests and zero model inference. The owner decides which work to keep, drop, investigate, or execute and starts agents explicitly.

This task makes collection reliable. It does not automate judgement about whether an issue is obsolete or resolved. Automatic closures and agent launches require a separately recorded explicit opt-in rule.

## Scope and data ownership

Use this default collection scope:

| Reported repository        | Implementation owner                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ShaulLavo/fregat`         | Fregat, with an explicit tree-sitter-x routing rule for its prefixed reports.                                      |
| `ShaulLavo/mesh`           | Mesh.                                                                                                              |
| `ShaulLavo/tree-sitter-x`  | tree-sitter-x. Its issue tracker is currently disabled; report that state and include its Fregat-prefixed reports. |
| `ShaulLavo/tree-sitter-md` | tree-sitter-md.                                                                                                    |
| `ShaulLavo/singapore`      | Fregat's Editor packages. Preserve the mirror issue URL.                                                           |
| `ShaulLavo/ghostty-webgpu` | Fregat's `ghostty-webgpu/`. Preserve the mirror issue URL.                                                         |
| `ShaulLavo/hotkeys`        | Fregat's `hotkeys/`. Preserve the mirror issue URL.                                                                |

Persist the scope in one versioned collector configuration consumed by both manual and scheduled runs. Do not infer additional repositories from the GitHub account. An eventual app configuration control must use the application settings registry; do not add environment tunables.

Use repository identity plus issue number as the stable issue key. Retain source URL, title, labels, state, creation/update time, body/comment revision information, and implementation owner. Preserve cross-links and related issues. Do not merge two reports automatically because their titles look alike.

Store complete successful observations and the owner's acknowledgement as separate durable records. The acknowledgement advances only through an explicit review action. Re-running collection must not silently acknowledge the backlog. Configuration changes start a named scope revision, retaining prior review history.

Manual mode has one local transactional checkpoint store. Recurring mode uses Plan 293's bounded workload checkpoints in Plan 294's replicated group as the authority. Its typed state contains scope revision, successful observation manifests and their issue shards, the explicit acknowledged snapshot, and outbox entries. Commit all referenced shards before their manifest. Every update names an expected checkpoint revision. Another executor reads that committed state before collecting or publishing. A local cache or report file cannot advance the acknowledgement or overwrite a newer revision.

Keep snapshots referenced by the current observation, review baseline, or pending outbox. Replicate the records needed to regenerate the report, not only local file paths or hashes. Credential values and private filesystem contents remain local. During quorum loss, retain the last report and show stale/unavailable state; fail acknowledgement and checkpoint mutations explicitly. Recovery catches up before resuming. Never acknowledge a review against an executor-local fallback store.

## Collection and report delivery

Add a portable Fregat script under `scripts/issues/` with CLI entry points for collect, inspect/report, and acknowledge. Use the existing authenticated `gh` CLI or a bounded injected GitHub API client. Never print tokens, complete auth files, or private local files. Request read-only repository metadata and issue data. Filter pull requests if the API returns them with issues.

Follow pagination through every selected repository. Inspect repository metadata to distinguish disabled issues from authentication failure, renamed repositories, and unavailable repositories. Use stable ordering and follow-up reconciliation for updates made during a paginated collection. Preserve the prior complete snapshot when an API call fails. Mark incomplete coverage explicitly and retry without treating an empty response as an empty backlog.

Collect newly closed/reopened issues and comment changes against known issue keys so the delta is complete. Conditional requests and incremental queries can reduce API work, but their watermark advances only after a complete committed observation. Rate limits trigger bounded deferred retry using the server's retry information. The report includes coverage and freshness rather than silently dropping failed repositories.

Generate Markdown and a small static HTML report from the same structured snapshot. Escape untrusted titles and bodies. Show actionable source links, the reported repository, the fix owner, open totals, and added/updated/closed/reopened changes since acknowledgement. Any classification is an existing recorded human decision or an explicitly marked unreviewed item. Age alone never produces a close recommendation.

Publish the HTML atomically to a dedicated sanitized output directory on a private Mesh static route. Return its reachable URL for the owner's Mac or phone. Choose the route from the registered host/service configuration, rather than hard-coding a fleet hostname. Do not expose private-repository content through a public upload or public app. The manual command also prints a useful text summary when the route is unavailable.

Use a durable report outbox keyed by scope revision and snapshot digest. Publishing the same snapshot reuses the same report identity. Record the canonical private report location and pending delivery, so another eligible executor can retry publication. Prefer one stable report URL with a visible last-updated timestamp. Sending email or chat messages remains outside this plan until the owner explicitly requests a delivery channel.

Commit the current publication location with the outbox revision. If its serving host is lost, another eligible publisher reconstructs the report from committed records and publishes through its approved private route. Report inspection returns the current reachable URL. A stable route can be reused where existing Mesh routing supports it; checkpoint durability cannot depend on one serving host or its local output directory.

## Durable scheduling integration

The manual collector must be usable before the Mesh scheduler exists. Once Plans 293/294 pass, register it as an explicitly enabled job with its versioned collector workload, local runtime, private report destination, and credential references available on eligible executors. Replicated job metadata contains no GitHub token.

Default to `0 0 * * *` in UTC and a five-minute execution timeout. These are operational defaults to implement, not latency claims. Allow the owner to choose cadence/timezone in the job definition. Skip overlap and coalesce missed runs. Declare collection and publication idempotent by snapshot/outbox key before enabling three total attempts, with one-minute and five-minute backoffs. Respect a longer server-specified rate-limit delay within the finite job policy. Failed publication retains the snapshot and pending outbox without advancing the review acknowledgement.

## Execution checklist

- [ ] Inventory existing issue scripts and the dated triage report. Confirm the seven-repository scope, mirror routing, and tree-sitter-x tracker state through read-only API metadata.
- [ ] Define scope revision, issue key, observation snapshot, acknowledgement, and report outbox types. Store them beneath a configured data directory rather than the repository checkout.
- [ ] Implement the local checkpoint adapter first and the quorum-backed adapter after Plans 293/294. Prove full snapshot reconstruction, revision-conflict handling, durable acknowledgement, and outbox recovery on a different executor.
- [ ] Implement read-only API collection with pagination, PR filtering, incremental closure/comment reconciliation, rate-limit handling, and incomplete-coverage preservation.
- [ ] Implement deterministic merged reports and deltas against explicit acknowledgement. Keep each source URL and implementation owner independently.
- [ ] Add manual collect/report/acknowledge commands and a useful text report. Confirm an actual issue appears in the combined list before claiming the GitHub view works.
- [ ] Add static HTML publication through the private route and durable outbox retry. Verify the report remotely from the owner's device path and keep the prior report available during publication.
- [ ] After the scheduler prerequisites pass, register the opted-in recurring workload and validate readiness on each eligible executor. Preserve manual operation and go/no-go decisions.
- [ ] Document adding/removing repositories, rotating local credentials, review acknowledgement, disabling the job, stale/incomplete reports, and report recovery after host loss.

## Verification and delivery

Use injected third-party API fixtures to exercise more than one page, disabled issues, inaccessible private repositories, renamed repositories, PR entries, issues changed during collection, reopened issues, comment-only updates, rate limits, interrupted snapshot commits, and failed report publication. Verify retries neither advance acknowledgement nor duplicate the report identity.

Run one authenticated read-only collection against the real scope. Compare per-repository open counts and a known issue/comment with direct API responses. Open the published private report through the product-native collaborative browser and read its screenshot. Confirm original mirror URLs and Fregat fix routing. Confirm a failed repository displays incomplete coverage rather than a zero count. No verification prompt starts a model or closes an issue.

Test scheduled failover using the disposable three-host scenario from Plan 294. Acknowledge a review and commit an unpublished snapshot/outbox, then remove the original executor and its local checkpoint/output from the fixture. Retry on another eligible host and reconstruct the same report identity and review baseline from replicated records. Also lose the serving host and verify publication and current-URL recovery. Reject concurrent acknowledgement updates with an old checkpoint revision and refuse acknowledgement during quorum loss. Pause/cancel while a peer is offline, require catch-up before dispatch, and prove no new collection authorization occurs after that committed decision. Report already-authorized attempts as active or pending until reconciled, following Plan 294.

Run narrow collector tests and the required Fregat gates through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill. Commit and push owned paths, publish the private report, and return its URL and actual coverage. Deployment of recurring execution follows the Mesh delivery requirements. The scheduler issue transfers to Plans 293, 294, and 295 together.
