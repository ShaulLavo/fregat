# Offline alignment record check

Run from the repository root:

```sh
python3 scripts/parity/check.py
python3 scripts/parity/source.py --reference references/t3code
python3 -B -m unittest discover -s scripts/parity -p 'test_*.py'
```

The checker reads Plan 126's committed inventory, reports, ledger and contract assignments,
plus provenance fields in `test/parity/t3code/*.json`. It never updates records, fetches
upstream source, starts a server, or treats incomplete work as complete. Unverified findings
are reported and do not fail the structural check.

It rejects missing or duplicate assignments, stale finding titles, mismatched fixture pins,
and findings marked verified using source review alone. A verified finding must have
`evidence_level: "runtime-compared"`, nonempty `execution_evidence`, and a
`runtime_comparison` object containing:

- `upstream_commit` matching the inventory pin
- `result: "matched"`
- `upstream_artifact`, `local_artifact`, and `comparison_artifact`, each naming a distinct,
  existing repository-relative file

These checks establish record consistency only. Artifact contents still need review.
The checker does not execute comparisons or prove that a reported result is true.
Absolute paths to temporary browser evidence may remain in an in-progress finding's
execution evidence, but they cannot satisfy the durable runtime comparison requirement.

The old type-discriminant inventory mixes commands, events and data variants.
It must not be reported as command coverage.

`source.py` checks all pinned contract blob hashes and named RPC methods against
the existing inventory. It uses Git objects at the exact pin, never the reference's
working tree, and makes no network requests. Changed contract contents, including
defaults that leave operation names unchanged, fail the check. Changes outside the
contract directory are not tracked by this census.

The source checker classifies upstream client and internal commands by explicit
union membership. Its parser accepts the pinned source shape and fails if a new
shape cannot be classified. Duplicate upstream union members are counted once.
Local client/internal command membership comes from the real Valibot schemas through
`local-commands.ts`, including nested variants and imported command arrays. This step
requires Bun and the checkout's installed dependencies.

`test/parity/t3code/operations.json` records these censuses and one unverified row per
RPC or client/internal command. Membership or pin changes fail until the artifact is
reviewed. The checker never infers equivalent behavior from matching names. Every row
currently has an unknown local mapping. The `--initialize` option creates this artifact
only when absent and refuses to overwrite existing review data.

Reviewed local entry points, capabilities, results, navigation, persistence, defaults,
negative paths, and runnable behavioral comparisons still need implementation. The
current operation checker deliberately rejects claims of reviewed mappings until a
behavioral checker can validate their evidence. The existing plan census also checks
export declarations and historical metadata; neither checker proves behavioral parity.

The focused unit tests cover plausible record failures, including false verification
claims, missing coverage, duplicate methods, missing comparison artifacts and stale pins.
They are checker tests, not behavioral conformance tests for the application.

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
