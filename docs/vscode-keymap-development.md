# Keyboard development

[Keymap architecture](keymap/architecture.md) defines dispatcher ownership, context resolution,
presets, authored overrides and terminal input. Plans204–206 deliver these together. Older
matcher delivery records remain in Git history; the [historical baseline](keymap/baseline.md)
records their original measurements.

## Adding commands and bindings

Keep command IDs, titles, typed arguments and mutation policy in the shared command catalog.
Put chords and context predicates in host preset data or named product packs. Commands that
belong to a mounted widget register handlers on that widget's focus node. Command execution
validates availability and read-only policy after binding resolution.

Fregat owns one browser dispatcher per window. Hosted Editors and terminals use that dispatcher
and add focus nodes without bindings. Standalone products own a dispatcher with their exported
base/default packs and user entries. Plugin state is sampled through live context readers.
Specialized Editor widgets preserve Editor ancestry when attaching their own nodes.

`ours` and `zed` use the pinned Zed translation; `vscode` imports named Editor packs and explicit
app rows. The translation retains upstream predicates and action arguments and records unmapped
actions. Regular presets exclude Markdown formatting bindings.

## Settings and hints

The application-scoped `keybindings.overrides` list contains assignment, null reservation and
targeted unbind rows, with optional context predicates. Edit the setting through its registered
mutations so the cache settles before the operation resolves. Reset removes authored entries
for the selected command and context.

Settings derives shadowing from `bindingsForInput`. A deeper matching default can shadow a
shallower user row; the report explains the result. Menu shortcuts, palette hints, tooltip chips
and held-modifier badges use the same resolved bindings.

## Input ownership

Terminal input contributions arbitrate synchronously before encoding. Unhandled keys fall
through once; `terminal.sendKeystroke` delivers the authored keystroke or text payload once.
Native protocol replies bypass claims. The dispatcher's existing event observation path keeps
native press/release ownership without an additional terminal keyboard listener.

Raw shortcut actions use focus-node commands. Native text input, composition, completion commit
characters and widget navigation keep their domain input behavior. Bare F1–F12 remain available
in text fields through authored context predicates.

## Verifying a change

Run the narrow product or host test that can catch the changed behavior. A shortcut that crosses
Editor, terminal or widget focus also needs browser coverage. The command-foundation scenario
covers Markdown sidebar toggle, editor history navigation, shell Ctrl+B and focus cancellation.
Use the large-file typing trace for performance claims, keeping the fixture and host identity
constant and distinguishing dispatch time from input-to-paint latency.

Browsers may intercept tab shortcuts before page delivery. Headless results cannot qualify
macOS desktop shortcuts or a real browser's reserved keys. Device-specific checks use their
separate execution grants.
