# Shared keymap historical baseline

Historical baseline recorded on 2026-09-05, before implementation.
See [delivery](delivery.md) for the completed runtime and Platform migration.

## Dependency pairing

- Editor: `d31e73066af3ca2c2b6de7c48b5d84345ccea0e4`.
- Platform before reconciliation: `0f5b06181d1d79893ac7c94a5f996cc3938a0ac0`.
- Concurrent environment work landed at `e3e29b8e`, including the CI pin and SHA checkout support.
- The linked Editor checkout was clean. Its existing diagnostic-navigation commit was
  pushed with session authorization. A fresh shallow fetch of that SHA from GitHub passed.
- CI now requires an explicit Editor ref and fetches it before detached checkout.
- Editor has no root `CLAUDE.md`; its `AGENTS.md` was read.

## Repeatable comparison

From the Platform root:

```sh
bun --cwd apps/web scripts/keymap-baseline.mjs > /work/tmp/keymap-baseline.json
```

The script resolves Editor through the installed package, compares normalized source
and built binding contents independently for each platform, and exits unsuccessfully
if they differ. It records command IDs, conditions, resolved editor-pane bindings,
reservations, trie drops, and commands absent from Platform's registry.

Use `--built PATH` to select a built module to compare. A control module that
changed one binding to `F24` without changing the row count produced exit code 1.
The actual installed build produced exit code 0 before and after the Editor build.

| Platform | Editor pack rows | Platform defaults | Active editor-pane rows | Missing bound Editor commands |
| -------- | ---------------: | ----------------: | ----------------------: | ----------------------------: |
| macOS    |              102 |               125 |                     122 |                            34 |
| Windows  |               98 |               106 |                     103 |                            33 |
| Linux    |              100 |               108 |                     105 |                            33 |

Across the complete Editor command union, 38 IDs lack a Platform registry entry.
This is an identity comparison. It includes `editor.action.goToDefinition`, whose
separate `goToDefinition` ID is already registered, so it does not imply 38 distinct
missing behaviors. The generated report lists every ID and separates unbound commands
from commands that already have Editor defaults.

## Matcher baseline

The comparison also runs 100,000 trie root lookups after 10,000 warmup lookups.
The fixed workload includes a chord prefix, editing keys, Hebrew physical-key
fallback, an AZERTY printed-letter case, and an unmatched function key.

| Platform | Elapsed milliseconds |   Miss |    Arm |    Run |
| -------- | -------------------: | -----: | -----: | -----: |
| macOS    |                 8.29 | 42,856 | 14,286 | 42,858 |
| Windows  |                19.21 | 28,571 | 14,286 | 57,143 |
| Linux    |                 6.16 | 28,571 | 14,286 | 57,143 |

These are local Bun 1.4.0 measurements, not an end-to-end input latency claim or a CI
threshold. Repeat the same workload after extraction and compare match outcomes as
well as timing. No rows reached the trie's discarded list in this baseline; earlier
pane resolution has already removed three rows per platform.

## Migration points

- `packages/editor/src/editor/keymap.ts` owns the single-hotkey controller, command
  packs, and layer resolution. No public `./keymap` export exists yet.
- Editor's public options flow through its React wrapper and Solid reactive options.
  The controller must own the runtime so consumers need no additional wiring.
- Platform document editors use supplied layers with `defaultBindings: false`.
  Settings JSON uses the shared editor component; search results have their own
  editor options. Diff panes currently supply an empty layer list.
- `keymap/editor-keymap.ts` drops chords at the single-stroke bridge. The Platform
  trie stores one terminal candidate and removes longer conflicting sequences.
- `keymap/state/chord-session.ts` owns document listeners, held-key ownership,
  timers, focus cancellation, terminal event deduplication, and lifecycle logging.
  Extract generic behavior while retaining bus, focus, and logging policy in Platform.

## Verification and remaining gates

- Existing chord, chord-machine, and keymap-trie tests: 45 passed across three files.
- Editor build: all 17 package tasks passed.
- Fresh GitHub fetch and detached checkout of the exact Editor SHA: passed.
- Source versus built binding comparison for all three platforms: passed.
- Same-count stale-binding control: rejected.
- Existing browser command-focus and terminal-keybinding tests: 10 passed across two files.
- Repository typecheck and scoped formatting/lint checks: passed.

Standalone chord execution, conditional presets, the shared runtime, and Platform
takeover are still outstanding. Do not disable
embedded matching until the standalone and Platform policy gates in Plan 057 pass.
