# T3 Code nightly reference

The active reference is the published nightly `v0.0.46-nightly.20261010.2922`, released
2026-10-10 at 08:44:21 UTC, from commit `bd2346eda2e2c380d1844869c7fd16c279d2190f`.
[The release](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261010.2922)
and [the source commit](https://github.com/pingdotgg/t3code/tree/bd2346eda2e2c380d1844869c7fd16c279d2190f)
identify the same revision. Nightly is a release channel built from selected `main` commits.
An arbitrary `main` checkout, the stable release, and maintainer preview builds are separate references.

[Plan 343](../plans/343-t3code-nightly-orchestration.md) owns the Approved, deferred rewrite.
[Plan 126](../plans/126-t3code-alignment.md) retains earlier delivery and remaining product scope.
The owner requested reference and planning updates on October 10. Implementation is deferred.

## Reproduce the reference

Reuse the ignored checkout at `references/t3code`. For a fresh clone, create it there:

```sh
git clone https://github.com/pingdotgg/t3code references/t3code
git -C references/t3code fetch --no-write-fetch-head origin tag v0.0.46-nightly.20261010.2922
git -C references/t3code checkout --detach v0.0.46-nightly.20261010.2922
git -C references/t3code rev-parse HEAD
python3 -B plans/343-t3code-nightly/reference-audit.py --reference references/t3code
```

Check an existing reference checkout for local changes before switching it. Its expected HEAD is
`bd2346eda2e2c380d1844869c7fd16c279d2190f`. The audit verifies the tag and Git object hashes recorded
in [the pin manifest](../plans/343-t3code-nightly/reference-pin.json). It reads pinned Git objects,
so moving the working tree later cannot silently change the plan's reference.

Refresh by selecting the non-draft GitHub nightly release with the newest `published_at`.
Match tags containing `-nightly.` or starting with `nightly-v`, following upstream
`.github/scripts/check-nightly-release.cjs`.
Resolve its tag to a full commit and record publication time, release URL, changed source objects,
and a reviewed delta before changing the manifest. `.github/workflows/release.yml`,
`.github/scripts/check-nightly-release.cjs`, and `scripts/resolve-nightly-release.ts` in the
reference explain release selection. GitHub's latest stable endpoint does not select nightly.
Refreshing the reference requires a plan delta and new verification records for affected behavior.

## Nightly architecture

The active server implementation is `apps/server/src/orchestration-v2/`. Its domain separates an
application thread, run, run attempt, execution node, provider session, runtime request, and turn item. Provider process sessions can host several native threads.
`packages/provider-core/src/server/ProviderAdapter.ts` defines this execution boundary.
`packages/contracts/src/orchestrationV2.ts` defines their schemas, commands, events, and projections.
`packages/contracts/src/orchestrationV2.ts` defines message dispatch modes, while
`packages/contracts/src/orchestrationDispatch.ts` defines a dispatch-error contract. The nightly names
inform ownership; Fregat's session and worktree vocabulary still needs an explicit mapping.

Commands enter through `apps/server/src/ws.ts` and the v2 orchestrator. `ThreadCommandExecutor.ts`
uses a keyed lock. `EventSink.ts` commits events, projection changes, command receipts, and durable
effects in one transaction, then publishes committed updates in sequence order. `EffectOutbox.ts`
and `EffectWorker.ts` own leased side effects in ordered lifecycle and metadata lanes.
The event log in `apps/server/src/persistence/OrchestrationEventStore.ts` provides one application
sequence for project and thread events. Filtered streams can legitimately skip sequence numbers.
A committed command receipt means accepted domain state;
provider execution and effect completion have separate outcomes.

`EffectOutbox.ts` distinguishes effects safe to recover after process loss from operations bound to
the lost process. Provider starts, interrupts, steering, restarts, and request responses belong to
the latter set. Recovery is a domain decision. Replaying event history does not authorize resending
a prompt. `ProviderRuntimeRecoveryService.ts`, `RestartContinuation.ts`, and
`ProviderSessionManager.ts` implement recovery and retained provider ownership.

Client synchronization lives in `packages/client-runtime/src/state/`, including `orchestration.ts`,
`shell.ts`, `shellReducer.ts`, `threadDetail.ts`, and `threadExecution.ts`.
`apps/web/src/state/orchestration.ts` instantiates that package's environment atoms.
`apps/web/src/lib/orchestrationV2Timeline.ts` maps v2 detail to timeline rows. The old web
`store.ts` and `environmentApi.ts` paths from earlier reference notes are obsolete at this pin.

## Read the source by responsibility

All paths below are relative to the pinned T3 Code repository.

| Responsibility                       | Starting points                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain and command admission         | `packages/contracts/src/orchestrationV2.ts`, `orchestrationDispatch.ts`; server `orchestration-v2/CommandPolicy.ts`, `ThreadCommandExecutor.ts`, `Orchestrator.ts`                            |
| Durable commit and effects           | Server `orchestration-v2/EventSink.ts`, `EventStore.ts`, `CommandReceiptStore.ts`, `ProjectionStore.ts`, `EffectOutbox.ts`, `EffectWorker.ts`                                                 |
| Message intake and run execution     | Server `orchestration-v2/ThreadMessageIntake.ts`, `RunExecutionService.ts`, `ProviderTurnStartService.ts`, `RunFinalizationService.ts`                                                        |
| Provider ownership and recovery      | Server `orchestration-v2/ProviderAdapterRegistry.ts`, `ProviderSessionManager.ts`, `ProviderEventIngestor.ts`, `ProviderRuntimeRecoveryService.ts`, `RestartContinuation.ts`, `Adapters/`     |
| Requests, steering, provider changes | Server `orchestration-v2/RuntimeRequestService.ts`, `ProviderTurnControlService.ts`, `ProviderSwitchService.ts`, `ProviderContinuationService.ts`                                             |
| Checkpoints and context              | Server `orchestration-v2/CheckpointCaptureService.ts`, `CheckpointRollbackService.ts`, `CheckpointRestoreSafety.ts`, `ContextHandoffService.ts`, `ContextHandoffDelivery.ts`                  |
| Lifecycle and cleanup                | Server `orchestration-v2/ThreadLaunchService.ts`, `ThreadManagementService.ts`, `ThreadSettlementService.ts`, `ThreadDeletion.ts`, `ResourceCleanupService.ts`, `AttachmentClaims.ts`         |
| Read models and streams              | Server `orchestration-v2/WireProjection.ts`, `ShellStream.ts`, `LiveStreamBudget.ts`, `http.ts`; `apps/server/src/ws.ts`                                                                      |
| Shared client ownership              | `packages/client-runtime/src/state/`, `connection/`, `platform/orchestrationCache.ts`; web `state/orchestration.ts`, `state/use-orchestration-command.ts`, `lib/orchestrationV2Timeline.ts`   |
| Executable behavior examples         | Server `orchestration-v2/FoundationPersistence.test.ts`, `RestartContinuation.test.ts`, `SteeringCompletion.integration.test.ts`, `SelectionRestart.integration.test.ts`, `testkit/fixtures/` |

## Fregat decisions retained

Fregat keeps Bun, Elysia/Eden, Drizzle, Valibot, structured errors, TanStack Query and mutations,
its shared client core, and its session/worktree ownership until a measured design qualification
changes a specific decision. Effect and Effect atoms are upstream implementation choices.
Plan 343 compares a typed-service port with an isolated Effect-core alternative before execution.

Preserve local command-intent fingerprint checks, attachment claims, remote environment identity,
terminal ownership, checkpoint safety, and bounded caches. Qualify their behavior under the new
model. Nightly's large service files, unbounded pubsub choices, old-version import code,
forward-compatibility machinery, and version-skew behavior are subject to Fregat's own constraints.
The reference does not override them.

## Earlier comparisons

The September Plan 126 comparison baseline is `7445aa733ada33e45289e5aa5055f79142556513`.
`scripts/parity/pinned.ts`, its inventory, ledger, and retained comparison artifacts continue to
identify that historical baseline. They establish only the cases they actually executed.
They do not establish nightly conformance. [The comparison guide](../scripts/parity/README.md)
explains how to run them without changing their provenance.

The older architecture guide is available in Git history before this October 10 revision.
Dated gap analyses, percentages, stack tables, delivery reports, and acceptance counts refer to
the revisions each report inspected. [The reference inventory](../plans/343-t3code-nightly/reference-inventory.json)
classifies remaining citations for migration and preserves attribution notices.
