# Alignment records and executable comparisons

Run from the repository root:

```sh
python3 -B scripts/parity/check.py
python3 -B scripts/parity/source.py --reference references/t3code
python3 -B -m unittest discover -s scripts/parity -p 'test_*.py'
bun scripts/parity/follow-ups.ts --summary
```

The record checker reads Plan 126's committed inventory, reports, ledger and contract
assignments, plus provenance fields in `test/parity/t3code/*.json`. Incomplete records
remain incomplete and pass structural validation. It never fetches upstream or starts
a server. The source checker reads Git objects at the inventory's exact upstream commit,
checks contract blob hashes and RPC membership, and loads local command schemas with Bun.
The old type-discriminant inventory mixes commands, events and data variants; it is not
command coverage.

## Operation review states

`test/parity/t3code/operations.json` keeps every RPC and client/internal command explicit.
Names never establish equivalent behavior. Unknown rows remain accepted, and the checker
reports counts separately for these states:

- `unverified`: `localMapping` is null, with a reason explaining the missing review.
- `source-reviewed`: source anchors, local ownership and behavior dimensions are mapped
  to runnable scenarios. This is a source review, even when one narrow policy already
  has a passing runtime comparison.
- `runtime-verified`: every declared scenario has a validated paired comparison report.
  This establishes agreement for those cases only. Reviewers must still decide whether
  the declared cases cover the whole operation before closing its broader ledger finding.

A reviewed row requires `upstreamAnchors: [{path, contains}]`. `contains` is an exact
source substring, read from the pinned Git object. Its `localMapping` requires
`entryPoints: [{path, contains}]` against current local source, plus nonempty strings for
`owner`, `capability`, `defaults`, `results`, `navigation`, `persistence`, and
`negativePaths`. Unknown dimensions must say what remains unknown; a broad title cannot
stand in for review.

Every reviewed row also declares one or more executable scenarios:

```json
{
  "id": "follow-up-queue-policy",
  "runner": "scripts/parity/follow-ups.ts",
  "command": ["bun", "scripts/parity/follow-ups.ts"],
  "cases": ["latest-empty", "latest-singletons", "latest-pairs"]
}
```

The example abbreviates the case list. The committed mapping includes every case group.
The command must invoke its existing runner directly through Bun, Node or Python. Existing
browser scenarios can be linked during source review; they need a paired-output adapter
before they can satisfy runtime verification. Empty cases, missing scripts, stale anchors,
unknown operations and changed command inventories fail. `source.py --initialize` only
creates an absent artifact and refuses to overwrite review data.

## Runtime comparison records

`run.py` executes one declared scenario and writes durable observations. It does not
change a row's review state. For example, after reviewing a mapping:

```sh
python3 -B scripts/parity/run.py \
  --operation client-command:thread.turn.start \
  --scenario follow-up-queue-policy \
  --output plans/126-t3code-alignment/evidence/follow-ups
```

The output directory must be new. Use `--check` instead of `--output` to execute and
validate without writing artifacts, as the queued-policy CI step does.
The runner gets `PARITY_UPSTREAM_COMMIT` and
`PARITY_SUBJECT`, and emits one JSON object on stdout:

```json
{
  "upstreamCommit": "<inventory pin>",
  "cases": [{ "id": "archive-idle", "upstream": true, "local": true }],
  "negativeControls": [
    { "id": "ignore-archive", "caseId": "archive-idle", "output": false, "result": "rejected" }
  ]
}
```

The scenario executes both implementations, including deliberate wrong implementations
for the negative controls. Each control must name an observed case and retain its mutated
output. A `rejected` label whose output still matches upstream fails validation.

The runner rejects a nonzero exit, malformed output, stale pin, missing or extra case IDs,
different paired observations and surviving controls. It snapshots the runner and mapped
local entry points before execution, then checks that they did not change during execution.
It writes separate upstream and local observation JSON files and a comparison report with
SHA256 hashes, exact scenario declaration, case results and negative-control observations.
The printed comparison reference can be placed in a `runtime-verified` row's
`runtimeComparisons` array, one per declared scenario, after coverage review.

Both checkers validate report contents. An existing file or `result: "matched"` is not
sufficient. They reject changed source snapshots, swapped artifacts, stale pins, different
subjects or commands, skipped cases, missing case coverage, changed outputs and mismatched
hashes. A verified ledger finding still requires `evidence_level: "runtime-compared"`,
nonempty `execution_evidence`, and `runtime_comparison` with `upstream_commit`,
`result: "matched"`, and three distinct repository-relative paths named
`upstream_artifact`, `local_artifact`, and `comparison_artifact`. Its report subject must
be that finding's ID. A single operation's report cannot close an entire finding by relabeling it.

These checks validate retained observations and make executable cases repeatable. They do
not prove an adapter is honest, that normalization preserves every behavior, or that a narrow
corpus covers an entire feature. Review the adapter and its source anchors. Hashes cover the
runner and declared local entry points, not every transitive dependency. CI reruns the paired
suites to catch changes in the actual code they import. Absolute temporary browser evidence
can remain on in-progress findings but cannot satisfy durable comparison requirements.

## Paired queued follow-up policy

`bun scripts/parity/follow-ups.ts` extracts the exact contiguous
`latestCompletedToolActivityId` and `isQueuedMessageDue` functions from pinned
`apps/web/src/queuedMessageStore.ts`. It asserts both extraction boundaries, then uses Bun
only to remove TypeScript syntax. The state store and React components are not executed.

The corpus compares 5,396 evaluations in 12 named groups: absent and non-completed tools,
missing/negative/equal sequences, timestamp ties, unsorted snapshots and permutations,
all four phases, optional/false/true hold state, and equal/different/missing tool IDs.
Eight negative controls reject positional selection, timestamp-first selection, ignoring
timestamp ties, sending while connecting or held, waiting until idle, resending at the same
tool boundary, and waiting for ready after disconnection. Full stdout follows the runner
protocol above; `--summary` prints counts for CI.

The two reviewed operation rows link turn start and interrupt to local composer ownership.
They remain `source-reviewed`. These policy comparisons do not verify provider delivery,
queue drain races, attachment retention, Stop recovery, persistence or browser interaction.

`bun scripts/parity/wake.ts` executes the pinned upstream `threadWokeAt` module and
local `sessionWokeAt` on the same 189-case corpus. Bun removes TypeScript syntax only;
the upstream implementation comes directly from the pinned Git object. Field renaming
maps thread session/runtime and boolean request flags to local counts. The corpus covers
early completion/failure/request wake, invalid times and both sides of the timer deadline.
A timer-first negative control must fail. This is a paired pure-function comparison for
wake timestamps, not proof of sidebar interaction, provider behavior or all LIFE-07 cases.

## Paired snooze comparison

`bun scripts/parity/snooze.ts` executes the whole pinned upstream `threadSettled.ts`
module against local snooze functions in five isolated timezone processes. No source
expectation is rewritten to match the local implementation.

The corpus covers 10,095 paired cases across UTC, New York, Berlin, Jerusalem and Sydney:
75 calendar preset sets, 8,670 custom date/duration cases, and 1,350 effective-snooze cases.
It includes DST gaps and transitions, Sunday duplicate presets, leap days, rollover dates,
invalid strings, fractional/overflow durations, request state, completion and runtime changes.

Nineteen negative-control checks reject deliberate mutations across the timezone runs:
reintroducing Sunday's duplicate preset, using elapsed 24 hours for a calendar-day preset,
accepting calendar inputs without a round-trip validation, and inferring snoozed state from
whether a wake timestamp exists. The elapsed-day control runs only in DST-observing zones.

This comparison found and fixed a local defect: a pending request must end effective snooze
when both the runtime and snoozedAt timestamp are absent. Wake eligibility is independent of
whether a triggering timestamp can be displayed. The pre-fix implementation fails the corpus.

The shared `wake-cases.ts` corpus also feeds `wake.ts`, whose original 189 timestamp cases
and timer-first negative control remain unchanged. These comparisons establish bounded
pure-function behavior, not full LIFE-03 UI, scheduling or platform parity.

## Paired ordering comparison

`bun scripts/parity/ordering.ts` executes the complete pinned `threadSort.ts` module
and the contiguous pure marker/drop policy section of pinned `Sidebar.logic.ts`.
The extractor asserts its boundaries exist and retains the actual upstream function
bodies. UI imports and the surrounding React component are not executed.

The corpus compares 64 pinned/active sort permutations, 100 settled timestamp tuples,
32 settled sort permutations, 64 configured navigation sort permutations, 60 key-allocation
cases, 1,152 drop plans and 149 structural target moves: 1,621 cases. Six negative controls reject timestamp ties for equal pin
keys, keyed-first active order, hidden-key collisions, keyed-only truncation,
missing retained-snoozed-pin assignments and unsupported materialized neighbors.

This proves bounded pure-policy agreement. Persistence, command dispatch, optimistic
acknowledgement and browser drag behavior require their own evidence. Settled ordering
adds environment identity only when session IDs tie; the paired settled sort corpus
uses distinct IDs, matching the pinned upstream settled comparator's domain.

`bun scripts/parity/background.ts` executes the pinned background-liveness function and its
actual task-classification constants. It compares 720 transitions and rejects three wrong
policies: ignoring nested agents, reviving idle work from metadata, and treating watch loops
as agent work. This checks pure classification, not native-provider delivery or cleanup races.

`bun scripts/parity/response-delivery.ts` compares the pinned markdown splitter and
extracted buffering body against local delivery: 248 splitter cases, 190 mode/clock
steps, two rejected splitter controls. Cache lifetimes and reasoning activity
representation are outside this comparison.
