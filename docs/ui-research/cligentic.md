# cligentic

<https://cligentic.railly.dev/#how-it-works> · repo <https://github.com/Railly/cligentic> · clone `references/cligentic` (ae44399)

## What it is

**Not a UI library.** It is a shadcn-style registry of **TypeScript source blocks for building CLIs that coding agents will drive**. It is "shadcn for CLI infrastructure": you copy a block in, own it, and there is no runtime dependency. Blocks install with `bunx --bun shadcn add @cligentic/<block>` (no `components.json` needed; the registry is recorded in `package.json`) or with a raw `curl` of `r/<name>.ts`.

### How it works (the "how it works" section)

1. **Register once.** `shadcn registry add '@cligentic=https://cligentic.railly.dev/r/{name}.json'`.
2. **Find and install.** `shadcn search / view / add @cligentic/<name>`. `registryDependencies` pulls in the chain; for example, `trust-ladder` brings `json-mode` and `error-map`.
3. **Own it.** The files land in `src/cli/{agent,foundation,platform,safety}/`, ready to edit.

The core contract is **dual-stream output**:

- **stdout carries data only.** It is JSON when `--json` is set or stdout is not a TTY.
- **stderr carries NDJSON hints.** `{type:"next-step", command, description}` tells the agent what to run next.
- Errors are `AppError {code, message, hint}`.
- The **trust ladder** gates side effects. T0 and T1 pass silently. T2 prompts. T3 needs `--yes --confirm <id>`. In JSON or piped mode any T2+ gate **throws a structured error instead of hanging on a prompt**, so an agent never deadlocks on stdin.
- A **killswitch** file (`~/.app/KILLSWITCH`) blocks every write.
- An **audit log** records every write as append-only JSONL.

A companion agent skill (`skills/cligentic`, `bunx skills add Railly/cligentic`) teaches an agent to install blocks rather than rewrite them.

## License, stack, deps

- MIT (Railly Hugo).
- 24 blocks, about 2.4k lines of pure TS. Most have no dependencies. `json-mode` and `next-steps` use `picocolors`. `api-key-wizard` and `skill-installer-prompt` use `@clack/prompts`.
- Node `fs`, `path` and `child_process` APIs. They run under Bun.

## Catalog

| Layer      | Blocks                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| agent      | `json-mode`, `next-steps`, `trust-ladder`, `doctor`, `api-key-wizard`, `prompt-secret`, `skill-installer-prompt`                             |
| safety     | `killswitch`                                                                                                                                 |
| foundation | `error-map`, `audit-log`, `audit-lifecycle`, `atomic-write`, `xdg-paths`, `config`, `session`, `argv`, `global-flags`, `telemetry`, `banner` |
| platform   | `detect`, `open-url`, `copy-clipboard`, `notify-os`, `style` (NO_COLOR, `visibleWidth`/`padVisible`)                                         |

Browse: <https://cligentic.railly.dev/blocks>. Source: `references/cligentic/registry/`.

## Where it fits platform

Platform already has several CLIs **whose main user is a coding agent**: `bun run agent:browser` (`scripts/agent/browser.ts`, with `look/scenario/trace/renders/caches` and already a `--doctor`), `bun run logs` (`scripts/agent/logs.ts`), `bun run deploy` (`scripts/deploy/mesh.ts`, with `--rollback`), `compiler:explain/memos`, and `errors:census`. All of them parse with `node:util parseArgs` and print prose. None has `--json`. There is no `apps/cli`. `apps/tui` is an OpenTUI app, not a scriptable CLI.

Ranked steal list:

| #   | What                                                                                  | Platform surface                                                                                                                                                                  | How                                                                                                                        |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Dual-stream contract**: `--json` on stdout, `next-step` NDJSON on stderr            | `scripts/agent/browser.ts` (evidence dir, verdict and failures as JSON; next steps such as "read summary.md" or "run trace --compare"), `scripts/agent/logs.ts`, `compiler:memos` | Port the idea. We already have `createScriptError`, so build a small `scripts/lib/emit.ts` rather than copying `json-mode` |
| 2   | **Trust ladder** (T2 prompt, T3 `--confirm <id>`, throw instead of prompt when piped) | `scripts/deploy/mesh.ts`: `--rollback` and `--server` as T2 (an agent must pass `--yes`)                                                                                          | Port the idea. Owner said server restarts are fine, so keep it minimal                                                     |
| 3   | Trust-ladder vocabulary for **agent approvals in the product**                        | Plan 145 approval rules (`features/chat` pending-request and approval UI)                                                                                                         | Port the idea. T0–T3 is a clean way to name approval tiers in settings and docs. Compare with Codex `availableDecisions`   |
| 4   | **Killswitch file**                                                                   | Product: a global "stop all agents" that the server checks before provider writes and that is visible in the UI. Also a guard for `bun run deploy`                                | Port the idea. Check whether it duplicates the existing kill-all gesture first                                             |
| 5   | `next-steps` shape `{command, description, optional}`                                 | Our error `fix` field (catalog entries) could carry a machine-runnable `command` next to the human sentence                                                                       | Port the idea                                                                                                              |
| 6   | `doctor` block (checks → `{ok, checks[]}` with JSON mode)                             | `agent:browser --doctor`, a future `platform doctor` (server reachable, CLIs installed, auth, mesh route)                                                                         | Port the idea                                                                                                              |
| 7   | `style` (`visibleWidth`, `padVisible`, NO_COLOR)                                      | `scripts/agent/*` table output, deploy report                                                                                                                                     | Copy the code if needed (81 lines, MIT)                                                                                    |
| 8   | `api-key-wizard`, `telemetry`, `banner`, `xdg-paths`, `config`                        | none. We have the settings registry, the secret store and `PLATFORM_HOME`                                                                                                         | Skip                                                                                                                       |

**Bigger idea, the owner's call:** a `fregat` CLI (`apps/cli`) that agents running _inside_ platform call to drive the IDE. Examples: `fregat open <file:line>`, `fregat diff`, `fregat ask "<question>"` (raises an approval card), `fregat status --json`. It would be built on this contract with a skill like cligentic's. It is the `code .` equivalent plus an agent-to-IDE channel, and would sit beside the TUI (tui-plan §9, distribution) rather than inside it.

## Cost / risk

- Near zero for the idea ports: small, readable, MIT.
- Copying blocks verbatim clashes with repo rules. `AppError extends Error` would need to become `createError` from evlog, and prompts come from `@clack`. Port the contracts, not the files.
- The shadcn registry mechanism means nothing to us unless we publish our own blocks.

## Open questions

- Should `agent:browser` and `logs` get `--json` and `next-step` output? Agents are their main users today.
- Is a `fregat` agent-to-IDE CLI in scope, and if so, which lane? It relates to the agent workbench plans 139–145.
- Should the approval rules adopt T0–T3 naming?
