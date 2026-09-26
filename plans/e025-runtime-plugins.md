# E025: Design and prove reloadable user plugins

- Status: Proposed
- Kind: Research
- Owner: Cross-repo
- Priority: P2
- Effort: L
- Dependencies: [E026](e026-command-metadata.md), [E027](e027-extension-hooks.md), [E028](../docs/architecture/modal-input-findings.md)
- Inspected baseline: Editor `9abb944f3a2b8d6516953fdec75e8df5e1a94811`, Platform `c8e05123d8f89f74bdca0e73cd43bb060c6f4e67`.

## Outcome

Define a practical way to load, disable, and reload a user-authored Editor plugin without
closing its document. Prove the selected design with one bounded development plugin after
the design decision. Keep the document, selection, and undo history intact across reload.

The reference example aligns selected text with one batch edit and registers a named command.
Editing that plugin and reloading it replaces its behavior once, without leaving old commands,
listeners, or decorations behind. A failed reload leaves an explicit recoverable state.

## Current code

[EditorPlugin and its host](../packages/editor/src/plugins.ts) already provide install,
activate, update, deactivate, and dispose lifecycles. Command, edit, capability, view, and
decoration contributions already exist. This is a loader and contract problem, not a new
plugin system from nothing.

[Editor.setPlugins](../packages/editor/src/editor/Editor.ts) changes the active plugin set.
[Lifecycle tests](../packages/editor/src/editor/pluginLifecycle.test.ts) exercise identity,
disposal, and logging. [The public extension entry](../packages/editor/src/public/extensions.ts)
already exports the extension contracts, while the host implementation remains separate.

[The shared keymap entry](../packages/editor/src/public/keymap.ts) already supports chords.
[Find](../packages/find/src/plugin.ts) and [LSP](../packages/lsp-plugin/src/plugin.ts) provide
real contribution examples. Neither supplies user-file discovery or a reload coordinator.

The Fred description in [TODO.md](../TODO.md) is inspiration recorded by the project, not
evidence that browser plugins have the same authority or reload properties as native code.

## Scope

Deliver a capability gap report, a host trust decision, a measured loading comparison, and
a proposed loader contract. Follow that decision with one development-only proof when this
plan is scheduled. Public plugin installation UI and a plugin marketplace are separate work.

Editor supplies reusable lifecycles and typed editing access. Platform supplies any config
directory, file watcher, compilation service, origin policy, and user-visible error reporting.
A browser demo can accept a host-provided module loader without inventing filesystem access.

## Design

Compare host-precompiled ESM, host-compiled TypeScript, and browser-compiled TypeScript on the
same plugin. Measure cold load, reload, bundle cost, and retained module generations. Use the
existing statically bundled plugin as the behavioral and startup control.

Separate compilation location from execution authority. Loading code into the app origin can
grant access beyond the typed plugin context. A capability-shaped TypeScript API alone does
not constrain that code. A worker or isolated frame needs a restricted message protocol and
cannot receive the current DOM contribution context unchanged.

Classify user-owned trusted configuration separately from cloned workspace files. Do not
auto-execute a repository plugin because a workspace setting names it. Platform execution
settings must use its application or machine settings scope and registry.

Propose a loader state union with unloaded, loading, active, reloading, and failed states.
Each asynchronous result carries a generation identity. Disabling a plugin or closing its
owner invalidates pending work. All registrations belong to one plugin generation.

Evaluate preflight outside the live host, then replacement with rollback of owned registrations.
Module evaluation can itself cause side effects, so document what rollback can actually undo.
Prohibit document mutation during activation in the proof contract. Edits belong to commands.
Do not call an active plugin a sandboxed plugin unless the execution boundary enforces it.

Use E026 command declarations and the hook inventory from E027. E028 must first expose the
input contract's weaknesses. E025 records which contracts are supported, experimental, or
internal after that evidence. It does not declare the whole Editor implementation stable.

## Steps

1. Map the requested capabilities to existing APIs: command metadata, keybindings, batch edits,
   multicursor reads, snapshots, notifications, and view contributions. Record genuine gaps.
2. Produce the trust and deployment table for the Editor demo and Platform. Inspect current
   serving policy before selecting a module source or compiler. End with an authority decision.
3. Build disposable loading experiments against one harmless command plugin. Record startup,
   reload, failures, and retained references for each candidate using identical measurements.
4. Write the chosen loader contract and rejected alternatives in a proposed
   `docs/architecture/runtime-plugins.md`. Identify unsupported capabilities and host obligations.
5. If the decision supports a bounded pilot, prove load, invoke, reload, and disable through
   built public exports. Keep filesystem watching in the host adapter and disposal in Editor.
6. End with a go or no-go decision and the exact production follow-up scope. A no-go result
   closes the research when the evidence explains the blocked capability or unacceptable cost.

## Verification

From `packages/editor`, build with `bun run build` before testing built package exports.
Run `bun run test --project node src/editor/pluginLifecycle.test.ts` for relevant lifecycle
changes and `bun run test --project dom test/public-api.test.ts test/plugins.test.ts` for
public contract changes. Add only tests for the new generation and replacement behavior.

The pilot must prove that a reload leaves one command registration, one listener set, and no
obsolete decorations. A rejected module must not partially replace the active plugin.
Dispose during load, fail during activation, and race two reloads to catch stale completions.
Run the batch-edit example with multiple selections and verify one undo restores all edits.

Use a real browser to test focus, keyboard routing, and reload while two views are mounted.
Typecheck the React consumer after a public contract change. Reuse existing dev servers.
Acceptance requires a measured choice, documented authority, and an honest failure model.

## Risks and decisions

Unbounded cache-busting imports may retain module instances. A measured leak can rule out a
reload approach even when all registered listeners dispose correctly.
Untrusted execution may require a smaller API than existing DOM-capable plugins can use.
Do not expand the pilot into a remote installation system to avoid making that decision.
If E028 needs internal imports, record and resolve the proven gap before promising plugin stability.
