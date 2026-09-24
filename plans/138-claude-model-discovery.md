# Plan 138: Claude models come from the Claude CLI

## Status and authorization

- Status: IMPLEMENTED 2026-09-24 — all four phases; scenario `chat-claude-catalog` green.
- Priority: P1. A released model (Opus 5.5) is unreachable from the picker and from chat.
- Effort: M overall. Phase 1 is S and ships alone.
- Risk: MED. Phase 2 changes which binary every Claude spawn runs.
- Planned at: Platform `c2af88b4`, 2026-09-24.
- Every phase changes the server: deploy with `bun run deploy --server`, which drops live
  terminal and agent sessions. Say so before deploying.

## Implementation notes

- Phase 1 skipped its temporary `CLAUDE_MODELS` entry: Phase 3 landed in the same pass.
- The bundled CLI version comes from the SDK's own `package.json` (`claudeCodeVersion`), not the
  platform package, which ships no `manifest.json`.
- Opus 5.5 defaults to `medium` effort through a slug overlay entry, matching T3's `opus-5-5`
  profile; the rest of the family stays `high`.
- Slugs drop the date suffix as well as `[1m]` (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`),
  as T3's aliases do.
- Terminal resume asks the adapter for its executable (`ProviderAdapter.executablePath`); the
  registry leases synchronously and the service resolves the command after claiming the session.
- The TUI picker labels legacy models instead of folding them.
- Not driven live: a bogus configured `binaryPath` in the providers UI. The adapter test pins the
  error snapshot and its fix.

## Outcome

The Claude model picker lists what the Claude CLI says it supports, and chat runs the same CLI
that answered. A new model appears when the CLI learns it, with no code change, no release and
no hand-edited table.

## Why the picker missed Opus 5.5

Two independent causes, both measured:

1. **The catalog is a literal.** `apps/server/src/provider/adapters/utils/claude-models.ts`
   holds five hand-written `ProviderModel`s; `ClaudeProviderAdapter.snapshot()` returns them
   unchanged. Its comment says the profiles "match the pinned T3 manifest"; T3 has since moved
   to a remotely refreshed manifest and added Opus 5.5 on 2026-09-22 (`f25a8e4b`).
2. **Chat does not run the user's `claude`.** No spawn sets `pathToClaudeCodeExecutable`, so
   sessions and probes run the CLI bundled in `@anthropic-ai/claude-agent-sdk` — 0.3.269
   bundles CLI 2.1.269 (built 2026-09-11). `claude-auth.ts` `claudeBinaryPath()` also prefers
   the bundled binary on purpose. The user's installed CLI is 2.1.281. Only terminal resume
   (`provider-adapter-registry.ts`, `binaryPath || 'claude'`) runs the installed one, and the
   Claude driver ignores `ProviderInstanceConfig.binaryPath` everywhere else.

`supportedModels()` measured against both binaries (never-yielding prompt, ~470 ms, no API
request):

| Row `value`            | Bundled 2.1.269 `resolvedModel` | Installed 2.1.281 `resolvedModel` |
| ---------------------- | ------------------------------- | --------------------------------- |
| `default`              | `claude-opus-5[1m]`             | `claude-opus-5-5[1m]`             |
| `opus[1m]`             | `claude-opus-5[1m]`             | `claude-opus-5-5[1m]`             |
| `claude-fable-5-1[1m]` | `claude-fable-5-1`              | `claude-fable-5-1`                |
| `sonnet`               | `claude-sonnet-5`               | `claude-sonnet-5`                 |
| `haiku`                | `claude-haiku-4-5-20251001`     | `claude-haiku-4-5-20251001`       |

Each row also carries `displayName`, `description`, `supportsEffort`, `supportedEffortLevels`,
`supportsAdaptiveThinking`, `supportsFastMode` and `supportsAutoMode`. The same list arrives as
`initializationResult().models`, which `probeClaudeAccount` in `claude.ts` already awaits on
every snapshot. **The catalog costs no extra spawn.**

Reproduce with a scratch script (not committed):

```ts
import { query } from '/work/projects/platform/apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'
const abort = new AbortController()
const exe = process.argv[2]
const q = query({
  prompt: (async function* () {
    await new Promise((r) => abort.signal.addEventListener('abort', r))
  })(),
  options: { abortController: abort, ...(exe ? { pathToClaudeCodeExecutable: exe } : {}) },
})
try {
  console.log(JSON.stringify(await q.supportedModels(), null, 2))
} finally {
  abort.abort()
}
```

`bun probe.ts` runs the bundled CLI; `bun probe.ts "$(readlink -f "$(which claude)")"` runs the
installed one.

## What the references do

| Reference   | Binary                                   | Model list                                                                                           |
| ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| VS Code     | SDK                                      | `supportedModels()` + `accountInfo()` on one throwaway query; drops `default`; empty when no account |
| Orca        | installed                                | `supportedModels()` (`list_models`) to admit efforts and Fast per model                              |
| Paseo       | installed (`pathToClaudeCodeExecutable`) | static `providers/claude/model-manifest.ts` (has Opus 5.5)                                           |
| T3 / t1code | installed (`binaryPath`)                 | static JSON manifest, refreshed hourly from GitHub `main`; init probe reads account only             |

Nobody documents why they avoid `supportedModels()`. Its real limits, all visible above:

- Current lineup only. Opus 5 and Fable 5 are gone from the list, though explicit ids still work.
- Aliases (`default`, `sonnet`, `opus[1m]`); `resolvedModel` names the concrete id.
- 1M context is a separate `[1m]` row, not an option on the model.
- No default effort, no `ultrathink`/`ultracode`, no Haiku thinking toggle.
- It answers without credentials (VS Code's comment), so it says nothing about entitlement.

Each limit is a mapping rule or a small overlay, not a reason to hand-maintain the list.

## Decisions

Decided 2026-09-24. The owner's rule: take whatever is closest to T3 Code, adjusted where our
situation argues for something better. T3's answers come from `references/t3code` `origin/main`
(`model-manifest.json`, `Drivers/ClaudeExecutable.ts`, `ModelPickerContent.tsx`).

- **D1 — Binary when `binaryPath` is empty: the installed `claude` on the instance's `PATH`,
  unless it is older than the bundled one.** T3 defaults `binaryPath` to `"claude"` and has no
  fallback. We keep the bundled binary as the fallback when no `claude` is found, and also when
  the installed one reports an older version than the bundled one, because an older CLI under
  a newer SDK is the protocol skew T3 tracks with its compatibility ranges. An explicit
  `binaryPath` always wins.
- **D2 — Slugs are concrete ids (`claude-opus-5-5`), never aliases.** Same as T3, whose
  manifest lists aliases (`opus`, `sonnet`, dated ids) that normalise to the slug. The CLI's
  `resolvedModel` supplies that mapping for free. Greenfield: `models.hidden` entries keyed on
  retired slugs are dropped, not migrated.
- **D3 — Retired models stay selectable in a Legacy group.** T3 keeps them with
  `status: "legacy"` and the picker shows them apart from current models. The CLI no longer
  lists them, so a short static legacy tail (slug, name, profile) supplies them; it only grows
  when a model retires, never when one is released. A CLI-listed model is always current, and
  a legacy entry the CLI lists again is current.
- **D4 — The default for a new chat stays `claude-fable-5-1`.** T3's manifest pins
  `defaults.chat` to it. It is a product choice, not the CLI's recommendation, and it must be
  in the catalog: when the CLI stops listing it, the default falls back to the CLI's `default`
  row and the snapshot event records that it did.

## Phase 1: Unblock Opus 5.5 today

1. `bun update @anthropic-ai/claude-agent-sdk` in `apps/server` (range `^0.3.269` already
   admits `0.3.281`). Confirm the platform package's `manifest.json` reports CLI `2.1.281`.
2. Add `claude-opus-5-5` to `CLAUDE_MODELS` with the Opus profile (effort default `high`,
   ultracode, Fast, 1M default). Phase 3 deletes this table; this entry exists only to be
   usable today.
3. Run the probe script against the bundled binary: `default` must resolve to
   `claude-opus-5-5[1m]`.

Caution: a release's `server/node_modules` symlinks the checkout's, and the bundled CLI is
spawned from disk per query, so the running mesh server spawns the new CLI as soon as
`bun install` finishes, before any restart. The SDK's JS stays at the old version until
`--server` restarts it.

## Phase 2: One Claude executable per instance

1. A resolver `claudeExecutable({ binaryPath, env })` returning `{ path, source, version }`
   with `source` one of `configured | installed | bundled` (D1). The version comparison reads
   `claude --version` for the installed binary and the SDK platform package's `manifest.json`
   for the bundled one. It replaces `claudeBinaryPath()` in `claude-auth.ts`.
2. `claudeDriver.create` passes `input.binaryPath` to the adapter (today it is dropped).
3. Every spawn uses the resolved path: `claude auth` runs, `probeClaudeAccount`,
   `probeClaudeCommandCatalog`, session queries (`claudeQueryOptions` gains
   `pathToClaudeCodeExecutable`), title and commit-message utility turns, and terminal resume
   (replace `binaryPath || 'claude'`). One resolution per instance; a settings change to
   `binaryPath` already recreates the instance.
4. The snapshot's `version` (always `null` today) carries the CLI version, and the
   `chat.pipeline.claude_adapter.snapshot.complete` wide event gains `executableSource` and
   `cliVersion`. A missing configured binary is a catalog error with a `fix`, not a silent
   fallback.

## Phase 3: Catalog from the CLI

1. `probeClaudeAccount` becomes `probeClaudeInitialization` and returns `{ account, models }`
   from the same `initializationResult()`.
2. `claude-models.ts` becomes the pure mapping `claudeCatalog(rows: ModelInfo[])`:
   - slug from D2; rows sharing a slug merge, and any `[1m]` row gives the model a
     `contextWindow` descriptor with `1m` as its default;
   - `effort` descriptor from `supportedEffortLevels`, plus `ultrathink`; `fastMode` from
     `supportsFastMode`;
   - name from the slug (`claude-opus-5-5` → `Claude Opus 5.5`, date suffix dropped), because
     `displayName` is generic (`Sonnet`, `Opus (1M context)`);
   - the `default` row is not listed; it only names the fallback default (D4);
   - every other row is `current`; the static legacy tail (D3) appends the retired models the
     CLI did not list, each marked `legacy`;
   - a small overlay keyed by model family holds only what the CLI cannot say: default effort,
     `ultracode` eligibility, Haiku's `thinking` toggle, and 1M for Sonnet if it remains
     selectable without a `[1m]` row. Each overlay entry carries a one-line reason.
3. `providerModelSchema` gains `status: 'current' | 'legacy'`, and the web picker lists legacy
   models in their own group after the current ones, as T3's `ModelPickerContent` does.
4. The adapter keeps its latest catalog. `claudeModelCapabilities` takes the catalog instead of
   reading a module constant; `claude-reasoning.ts` and `claudeModelId` read it through the
   adapter. A session started before any snapshot awaits the in-flight probe rather than
   starting with no capabilities.
5. A failed probe returns no models; `withRememberedModels` in the registry already keeps the
   previous list while the provider is not `ready`. No static fallback list.

## Phase 4: Delete and pin

- Delete the current-model literals; what remains is the legacy tail, the overlay and the
  `claude-fable-5-1` default (D4). Delete tests that restate model data. Mapping tests use captured `ModelInfo` rows with synthetic ids, so adding
  a real model never touches a test (T3 follows the same rule for its manifest).
- `claude.test.ts` fakes gain `models` on `initializationResult()` through the existing
  `createQuery` seam.
- Update the "pinned T3 manifest" comment's replacement and the provider section of any doc
  that names the Claude model list.

## Verification

- Phase 1: probe script output; `bun run logs` shows a session started on `claude-opus-5-5`.
- Phase 2: snapshot wide event shows `executableSource: installed` and `cliVersion: 2.1.281`;
  a configured bogus `binaryPath` surfaces the catalog error in the providers UI.
- Phase 3: server tests for the mapping and the adapter; `bun run agent:browser look` on the
  model picker lists Opus 5.5 with Fast and 1M, Opus 5 and Fable 5 under Legacy, and Fable 5.1
  as the new-chat default; the options menu for Fable shows no Fast. Add a picker scenario
  under `scripts/agent/scenarios/` if none covers it.
- Mesh: `GET /platform/release` after `bun run deploy --server`, then the same picker `look`
  against the mesh.

## Out of scope

- Entitlement gating (VS Code publishes an empty catalog without an account). Our auth status
  already blocks unsigned use; revisit only if the picker misleads.
- A remote manifest like T3's. The CLI is the source; there is no release cadence to bridge.
- Codex, which already discovers its models through `model/list`.
