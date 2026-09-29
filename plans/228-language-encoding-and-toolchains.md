# Plan 228: Add language, encoding and toolchain selectors

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206. Size: L. Triage item: ZT-09.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Change the active document language/encoding and manage LSP arguments and language toolchains.

## Covered Zed actions and behavior

`encoding_selector::Toggle`; `language_selector::Toggle`; `lsp_command_selector::ToggleArgumentsFocus`; `lsp_tool::ToggleMenu`; `toolchain::AddToolchain`.

- `language_selector::Toggle` opens a picker for the active buffer language and
  updates its language on confirmation. See
  [crates/language_selector/src/language_selector.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/language_selector/src/language_selector.rs).
- `encoding_selector::Toggle` opens a "Reopen with encoding" picker for a clean
  active buffer. Zed refuses dirty buffers and its unsupported shared/remote cases;
  selection re-decodes the source bytes. The selector enumerates its supported codecs.
  See [crates/encoding_selector/src/encoding_selector.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/encoding_selector/src/encoding_selector.rs#L45).
- `lsp_command_selector::ToggleArgumentsFocus` switches focus between the command
  picker and arguments field. See
  [crates/lsp_command_selector/src/lsp_command_selector.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/lsp_command_selector/src/lsp_command_selector.rs#L83).
- `lsp_tool::ToggleMenu` opens the language-server status/actions menu through the
  workspace's button handle. See [crates/language_tools/src/lsp_button.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/language_tools/src/lsp_button.rs) and
  [crates/zed/src/zed.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/zed/src/zed.rs#L622).
- `toolchain::AddToolchain` opens the toolchain picker in its add state, browses a
  path, resolves it for the current language/root, and adds the selected toolchain.
  See [crates/toolchain_selector/src/toolchain_selector.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/toolchain_selector/src/toolchain_selector.rs#L97) and
  `handle_add_toolchain` in that file.

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

Fregat identifies languages with [file-language.ts](../apps/web/src/lib/file-language.ts)
and [language.ts](../packages/client-core/src/files/language.ts). Editor accepts
language IDs through its document/plugin contracts. Server
[read.ts](../apps/server/src/fs/read.ts) uses
[text-encoding.ts](../packages/contracts/src/text-encoding.ts) to detect/decode UTF-8
and UTF-16; [write.ts](../apps/server/src/fs/write.ts) blocks lossy and non-byte-exact
writes. This does not yet provide a selected-codec round trip.
[registry.ts](../apps/server/src/lsp/registry.ts) and
[proxy-session.ts](../apps/server/src/lsp/proxy-session.ts) own server selection/lifecycle.
The registry already has `lsp.servers` and `lsp.languageServers` in
[keys.ts](../packages/contracts/src/settings/keys.ts).

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Keep document language override and selected encoding/BOM metadata with the shared
document owner. Language changes reconfigure syntax and the existing LSP document
subscription with that same language ID. Reopening reads original bytes through a
version-checked query; require save/discard before replacing dirty content. Preserve
codec/BOM across save through explicit encode/decode contracts, keeping the existing
lossy-write guard until the selected codec proves a safe round trip. Match Zed's
supported codec inventory and report decode/encode failures before writing bytes.

Add a language-tools feature with kind directories for selectors and toolchain UI.
Language-dependent resolution belongs in Editor language packages or the server LSP
owner. Toolchains are typed language/root/executable selections stored as registered
machine/application settings. Reuse `lsp.servers` for commands/arguments, and add
missing toolchain knobs to the registry. Server restart/rebind uses its lifecycle
owner through serialized mutations; validate paths at the execution boundary.
Use shared picker/field primitives, queries for status/path reads, and mutations for
add/reopen/reconfigure effects. Settle document/settings caches before they resolve.

## Steps

- [ ] Reproduce missing selectors and the current UTF-16 save refusal in fixture document tests.
- [ ] Define shared language/codec metadata and add versioned byte reads, supported codec decoding, and safe encoding on save.
- [ ] Add language/encoding picker commands and update syntax/LSP subscriptions atomically with the document identity.
- [ ] Add command/arguments focus and language-server menu commands over the existing status/lifecycle owner.
- [ ] Implement typed toolchain path resolution/addition and registry entries; regenerate settings schemas/reference.
- [ ] Add `language-encoding-and-toolchains`, inspect saved bytes/cache settlement and screenshots, then deploy web and server together.

## Acceptance

Run focused encoding, filesystem read/write, document save, settings, and LSP
registry/lifecycle tests. Test UTF-8/UTF-16 BOMs, representative legacy codecs,
malformed/unrepresentable text, dirty documents, concurrent byte changes, and unchanged
bytes after refusal. Reopen/save/reload must retain the selected codec and BOM.
Injected process/path resolvers verify toolchain selection without invoking a real
provider or account. In `agent:browser scenario language-encoding-and-toolchains`,
change language, reopen a fixture file with its codec, edit/save it, switch argument
focus, inspect server status, and add a fixture toolchain. Verify document/LSP
identity and saved bytes, read screenshots and cache settlement evidence back.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-09" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run deploy`, or
`bun run deploy --server --restart` when server code changes. Confirm the served release.

## Out of scope

Zed collaboration/account restrictions, downloading toolchains, arbitrary terminal
execution UI, and user-state compatibility migrations.
