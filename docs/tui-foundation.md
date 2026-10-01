# TUI foundation

Plan 079 establishes a second client for Platform's existing server. The terminal opens settings,
with a command palette, file picker and previews, address history, editable settings, and terminal
themes. Agent sessions and the workbench remain separate slices in [the strategy](../plans/tui-plan.md).
The [TUI guide](../apps/tui/README.md) covers launch, controls, editing and recovery.

## Shared ownership

`packages/client-core` owns HTTP construction, verified environment identity, orchestration RPC,
date/error normalization, command metadata and pure keymap helpers, palette grammar/ranking,
focus target resolution, settings intents/projection/write policy/live events, address grammar,
filesystem reads, and syntax-theme registration. It imports no React or browser runtime.
Web callers use those same modules; host handlers and notification/rendering adapters stay local.

The TUI supplies sockets, logging, persistent storage, renderer lifetime, native focus registration,
and command dispatch. Focus requests acknowledge actual renderable focus or report rejection or
supersession. Closing an overlay restores its captured origin, with a current-screen fallback
when the old widget no longer exists. Both hosts use the shared command metadata; the terminal
adapter resolves its authored defaults and the single settings override map.

The settings owner provides query observers, semantic intent projection, confirmed mirror reads,
SSE invalidation, and cancellation. Application writes use that owner. Raw JSON uses compare-and-set
with the revision captured when editing began. Editor execution is a host port and a machine-scoped
registry value; repository settings cannot choose an executable. File browsing only changes this
viewer's navigation history and convenience state, without introducing a global current project.

Each settings editor owns a cancellation lifetime. Closing it prevents a late completion from
closing a newer dialog or changing its draft. Server diagnostics identify ignored entries by key
and layer in a bounded, scrollable panel. Warnings for malformed files explain the retained values
or defaults. Details distinguish those effective values from ignored file contents.

## Terminal behavior

The renderer uses the alternate screen and restores it for editor handoff, job control, signals,
and quit. `Live` requires matching HTTP identity and an authenticated orchestration handshake.
Connection loss pauses settings writes/events and cancels file reads; reconnect verifies again.
The synthetic `platform-tui://local` origin is registered by the normal launcher.
Suspension stops the complete foreground job, including the Bun launcher, and `fg` resumes it.
The host refuses to suspend a process group shared with an enclosing shell. Ctrl+C and SIGTERM
restore terminal modes and finish shutdown.

Dialog, prompt, text prompt, toast, empty state and the five loader roles are shared TUI controls.
Every selectable list wraps; input and selection are read from native renderables on submission
so a fast paste or arrow followed immediately by Enter acts on the visible value. Dialogs render
above application chrome. All dialogs use the effective `workspace.dismiss` binding and display
its current hint. Changing between Open Address and Copy Address remounts the dialog with a fresh
request lifetime and input. Opening a settings editor removes the file picker overlay. Compact
layouts preserve content and status at 40×12 and 60×20.

Generated Graphite/Sage palettes use shared UI tokens. System mode reads terminal palette and
foreground/background colors; capability checks select truecolor, 256 or 16 colors. `NO_COLOR`
and reduced motion apply throughout. JSON highlighting converts shared Shiki tokens into native
cell ranges, including wide graphemes. The build checks generated palette drift.

Recent commands and picker location use a mode-0600 SQLite database per environment, with WAL and
per-key writes. Transactions merge recent-command histories across simultaneous processes without
overwriting unrelated keys. This convenience cache replaces the earlier JSON format without a
migration. Settings remain authoritative on the server. Invalid storage reports its path.
Deleting the corrupt cache permits a retry. JSONL logging uses the shared observability runtime
and redaction path. It does not depend on HTTP log ingestion.

## Verification

The 2026-09-05 completion recorded 126 passing TUI tests and eight passing client-core tests.
TUI build, generated palette check, lint, formatting, frozen lockfile validation, and affected
workspace typechecks also passed.

Those completion checks exercised real in-process Elysia routes and native OpenTUI rendering. They
covered identity refusal/replacement, all three socket routes, RPC teardown and resume, settings
scopes/CAS/live events, editor cancellation and child cleanup, live shortcut overrides, focus
restoration, palette modes, batched input, list wrapping, file completion/previews, address history,
theme degradation, compact frames, and environment-isolated storage.

Affected web checks covered migrated command/keymap/focus behavior, settings conflicts and live
updates, address/path parsing, filesystem reads, RPC reconnect and logging. A direct-entrypoint
PTY run verified a live in-process server session, external-editor save and return, Ctrl+Z/`fg`,
Ctrl+C, and terminal mode restoration. No development server was started; the default server port
was unavailable.

The original per-command slice audit and installed defaults are preserved in
[TUI command bindings](tui-bindings.md). Physical Kitty keyboard hardware was unavailable;
enhanced input was checked through OpenTUI's native event parser and remains capability-gated.

### Review checks, 2026-09-06

All 152 TUI tests across 37 files pass, along with the TUI build, generated palette check,
and TUI and launcher typechecks. Session disposal releases cache connections immediately and
retires pending command callbacks before they can write to closed storage.

Permanent regressions cover the seven review findings:

- Canceled settings saves preserve newer drafts. Invalid entries and malformed files expose their
  diagnostics, support repair, and remain readable at 40×12.
- Every dialog follows rebound or disabled dismissal commands. Switching address modes starts a
  usable dialog, and settings editors cannot overlap the file picker.
- Real PTY tests exercise direct startup and the repository launcher through suspension, `fg`,
  external-editor handoff, Ctrl+C, and SIGTERM. A separate case protects a shared shell group.
- Separate live handles and simultaneous processes preserve independent cache keys and merge
  recent commands. Invalid caches remain unchanged until explicitly deleted, and retry reopens
  the cache.
