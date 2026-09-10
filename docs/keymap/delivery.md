# Shared keymap delivery

Standalone Editor now executes default and custom chords through ordinary options. Platform uses
that same runtime for its combined app and Editor bindings, with each embedded Editor matcher
disabled. The command bus still owns command availability, target selection, and execution.

## Pairing and configuration

Plan 057 paired Editor `9abb944f3a2b8d6516953fdec75e8df5e1a94811` with Platform `958b97bb`.
Platform merged the delivery in `1ad2e6a5`. The verification below records that pairing.

Editor usage examples are in the paired repository's `packages/editor/README.md`: ordinary
`keymap` bindings execute automatically; hosts can choose `enabled: false` and mount the public
runtime themselves. Bindings use nonempty `chord` arrays and optional typed Editor conditions.

Platform's application-scoped `keybindings.preset` setting selects `default` or `vscode`.
Settings reports omitted preset rows, unmapped commands, invalid overrides, and collisions.
The command registry includes every Editor command. App reservations remain intentional policy;
conditional alternatives retain their order, and rejected overrides do not remove valid siblings.

One command-bus snapshot serves each stroke. The adapter checks the exact native Editor input,
read-only mutation rules, and current Editor conditions. Focus, document, or input replacement
cancels pending chords. Terminal forwarding uses the shared runtime's ownership result.

## Verification

- Editor: 10 trusted browser scenarios, 20 runtime contract tests, 13 trie/public-entry tests, full DOM
  suite (1,957 tests), package builds, typechecks, lint, and formatting.
- Platform: 82 focused policy and command-bus tests; 25 keymap/settings DOM checks; 36 keymap/focus
  DOM checks; 11 trusted command-focus and 5 real Ghostty terminal browser checks.
- Repository typecheck, production build, and generated settings schema checks pass.
- Source and built default and VS Code packs match on macOS, Windows, and Linux. The shared
  matcher produces the original outcomes against the original tables and event workload.

Reproduce the comparison from the Platform root:

```sh
bun --cwd apps/web scripts/keymap-baseline.mjs --baseline ../../docs/keymap/matcher-baseline.json > /work/tmp/keymap-final.json
```

The [recorded comparison](verification.json) includes original and final timings.
The baseline path is resolved from the command's working directory; when invoking from
`apps/web`, use `../../docs/keymap/matcher-baseline.json`. Timings cover 100,000 warmed matcher
lookups and vary with JIT and machine load. They are not end-to-end typing latency measurements.
The comparison also accepts `--built PATH`; a changed chord with unchanged row counts must fail.

## Boundaries

Local Editor widgets can stop bubbling keys before Platform receives them. Their local editing
behavior is preserved; app shortcuts stopped by those widgets remain unavailable there. This
change does not add a capture listener over native widget behavior.

User-authored condition expressions, modal keymaps, and recording more than two strokes remain
outside the delivered scope. See [the decision trail](decisions.tsv) and [historical baseline](baseline.md).
