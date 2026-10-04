# E026: Declare Editor command metadata once

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: In progress
- Kind: Implementation
- Owner: Cross-repo
- Priority: P2
- Effort: M
- Dependencies: None
- Inspected baseline: Editor `9abb944f3a2b8d6516953fdec75e8df5e1a94811`, Platform `c8e05123d8f89f74bdca0e73cd43bb060c6f4e67`.

Decided 2026-09-25: owner — unparked. Rebase the plan on the [E050 host contracts](../editor/docs/architecture/e050-host-obligations.md) first, then execute. Platform `ed96e9f16` hand-copied command metadata again, the duplication this plan removes.

Progress 2026-09-26 (wave 2, lane E1, with Platform Plan 122 phase 4): steps 1–4 and 6 are done.
`EDITOR_COMMANDS` (`packages/editor/src/editor/commandCatalog.ts`) declares every built-in's id, title,
category, mutation policy and VS Code ids; the id union and `editorCommandMutates` derive from it; named packs declare shortcuts separately. Contributed commands
are `createPlugin({ commands })` declarations under the plugin's name; dispatch, readonly refusal,
listing (`Editor.getCommandDeclarations`) and removal share one identity. `docs/commands.md` is
generated (`bun run commands:reference`) and checked by `health`. Step 5: Platform's client-core
builds its editor table from the catalog. Left: typed command arguments and Platform's runtime segment for
contributed commands in the palette, keybinding table and recorder.

## Outcome

Give every Editor command one authoritative declaration for its ID, human name, description,
category, mutation policy, and typed arguments. Named hotkeys packs own preset bindings. Hosts can list commands that have no binding
and show the same name in a command palette, shortcut recorder, and generated reference.

Adding a built-in command must not require independently updating a string union, a mutation
list, a keymap pack classifier, and a host title list. Handlers remain owned by their feature
and instantiated for the correct editor view.

## Current code

[commands.ts](../editor/packages/editor/src/editor/commands.ts) re-exports `EditorCommandId`, derived from
the catalog. Its `EditorCommandContext` carries an optional keyboard event; typed arguments remain
part of the host command contract work.
[EditorCommandRouter](../editor/packages/editor/src/editor/commandRouter.ts) dispatches built-ins
and accepts registered handlers. Plugin registration currently uses that same finite ID type.

[Keymap presets](../editor/packages/editor/src/keymap/presets.ts) already own default and VS Code
bindings and named pack data. The catalog classifies mutating commands. [The public keymap entry](../editor/packages/editor/src/public/keymap.ts)
exports named pack data and metadata. Plans [204](204-editor-on-fregat-hotkeys.md) and
[206](206-platform-one-keymap.md) assign the runtime to `@fregat/hotkeys`; the old runtime,
layer helpers, and their exports are removed in that cutover.

The wishlist's claim that titles and categories exist nowhere is stale across the project.
Platform has [Editor command declarations](../apps/web/src/keymap/editor-commands.ts),
[defineEditorCommand](../apps/web/src/keymap/define-command.ts), and
[derived command specs](../apps/web/src/keymap/command-registry.ts).
The remaining duplication is between reusable Editor facts and Platform's presentation metadata.

## Scope

Consolidate the built-in declaration model, derive the public metadata API, migrate existing
keymap consumers, and make Platform consume Editor's reusable facts. Keep Platform icons,
workspace targeting, host aliases, and palette visibility in Platform where they are policy.

Support a statically bundled plugin declaring one custom command through the same metadata
shape. Runtime file loading belongs to [E025](e025-runtime-plugins.md). General command macros,
an expression language, and a complete Vim command grammar are outside this change.

## Design

Propose command declarations near feature ownership and a pure assembled catalog with literal
IDs. Derive the built-in ID union from that catalog. Avoid a runtime import cycle between the
router, preset catalog, and declarations by keeping per-view handler factories separate from
the host-readable metadata projection.

A declaration describes handler ownership as built-in or contributed. Built-in installation
must be exhaustive over its IDs. A contributed command has metadata even before its provider
is available. Availability remains contextual and separate from whether the command is known.

Declare default and VS Code bindings in explicit named hotkeys packs, separate from command metadata. Preserve
ordered fallbacks, context predicates, and the distinction between no binding and unavailable.
Derive mutation classification from declarations so a new edit command cannot bypass readonly
checks because another list was forgotten.

Use a distinct validated namespace for custom plugin IDs without widening built-in IDs to
arbitrary strings. Couple typed command arguments to the command declaration when needed.
Keep keyboard events as invocation context rather than disguising command arguments as events.
E028 can add only the argument operations its modal proof requires.

Keep metadata data-only. A host listing commands must not create an Editor or initialize an
LSP connection. Disposal removes a contributed command's metadata and handler together.
Define duplicate ID rejection and intentional override policy before migrating the router.

## Steps

1. Inventory every built-in ID, handler route, mutation classification, pack, and preset binding.
   Compare the inventory with Platform's table and record the current command behavior.
2. Introduce the declaration type and catalog projection with two representative commands:
   one native edit command and one provider-owned command that can be unavailable.
3. Move all built-in facts into declarations. Derive the ID union, metadata export, mutating
   predicate, and preset views. Delete superseded lists in the same implementation pass.
4. Connect handlers through exhaustive typed installation. Add one fixture plugin command to
   prove that contributed metadata, arguments, dispatch, and disposal share one identity.
5. Migrate Platform's Editor table to enrich the exported metadata with app presentation and
   target policy. Preserve its existing command IDs, recorder rows, and availability behavior.
6. Generate a proposed `docs/commands.md` from the catalog and document the regeneration command.
   Verify a command rename changes all derived descriptions without a second manual title edit.

## Verification

Build Editor with `bun run build` from `packages/editor`. Run the focused existing checks with
`bun run test --project node test/keymap-public.node.test.ts` and
`bun run test --project dom test/hostedHotkeys.test.ts test/public-api.test.ts`.
These checks catch broken public imports, changed layer precedence, and changed chord handling.

Add catalog checks for missing IDs, duplicate IDs, a mutable command marked readonly-safe,
and unbound commands omitted from the metadata list. Assert preset results against the
named pack snapshots so reorganizing declarations does not silently rebind commands.

Use a real browser for the contributed command's focused-view dispatch and removal. A second
editor must retain its own handlers. Verify that one plugin command invocation makes one undo
entry and that readonly views reject mutations through both keyboard and direct dispatch.

In Platform's `apps/web`, run `bun run test src/keymap/tests/command-table.test.ts` and the
affected shortcut-row check selected from current settings tests. Typecheck both Editor and
the Platform adapter, plus Editor's React package, against the newly built exports.
Acceptance requires complete catalog coverage and no duplicate reusable command title list.

## Risks and decisions

A single giant registry can become a dependency magnet. Keep the assembled catalog pure and
feature declarations focused. One source of truth does not require one source file.
Preset identity and handler ownership must remain distinct. A missing shortcut is not a
missing command, and a registered title does not prove that its LSP provider is available.
Revisit current command IDs before implementation if upstream has already consolidated them.
