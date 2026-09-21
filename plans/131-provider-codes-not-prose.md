# Provider adapters branch on codes, not on prose

Status: **PROPOSED — PHASE 1 IS A SECURITY FIX AND SHOULD GO FIRST.** Requested 2026-09-21.
Inspected at Platform `d1ca6472`. Server-only; every phase needs `bun run deploy --server`, which
drops live terminal and agent sessions, so batch the phases into as few deploys as possible.

The provider adapters decide things by matching substrings of human-readable text: a permission's
lifetime from an option label, "the request is gone" from an error sentence, "not installed" from
the word `enoent`. Each works until someone rewords a string, and then it fails silently in the
direction of a wrong answer. The fix is the same everywhere: a declared value or an error code,
and an explicit "unknown" when there is none.

## What is on the table

| #   | Where                                                                                                 | What is matched                                                                                                                                                                                 | Failure mode                                                                                                                                       | Verified       |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | `provider/adapters/utils/codex-elicitation.ts:51-55`                                                  | `persistenceDecision`: `includes('session')` gives `acceptForSession`; `/always\|permanent\|forever\|persistent/` gives `acceptAlways`. Fed option values, field keys, titles and descriptions. | A label containing both words takes the first branch; a reworded option silently loses persistence. This decides how long a tool permission lasts. | yes            |
| 2   | same file, `:131`                                                                                     | App name parsed from `/^Allow ChatGPT to use (.+?)\?$/`, the last of an eight-deep metadata fallback chain.                                                                                     | Wrong or missing name on a consent prompt.                                                                                                         | no             |
| 3   | `orchestration/pending-requests.ts:126-135` and `orchestration/provider-command-reactor.ts:1014-1026` | "Provider forgot this request": `'no active provider session'`, `'unknown pending '`, and the prefix `'stale pending '`, which this repository synthesizes itself in the reactor.               | A pending approval is stranded forever, or one the user could still answer is cleared. Two matchers that must agree.                               | first file yes |
| 4   | `provider/adapters/claude.ts:2271-2277`                                                               | "Claude is not installed": `message.includes('enoent')` or `'exited with code 127'`, beside an honest `code === 'ENOENT'` check.                                                                | An ENOENT from inside the user's project reports the provider as not installed and hides the real error.                                           | no             |
| 5   | `provider/adapters/codex.ts:3286-3303`, `:97-100`                                                     | Codex's Rust `tracing` stderr is regex-parsed into levels, with two hardcoded "benign" snippets suppressed.                                                                                     | A formatter change surfaces log noise as user errors; a reworded real error stays hidden.                                                          | no             |
| 6   | `provider/adapters/claude.ts:2303-2317`                                                               | Tool kind from display-name substrings (`command`, `shell`, `websearch`).                                                                                                                       | A user's MCP tool named "Run shell command" renders as a native command execution.                                                                 | no             |
| 7   | `provider/adapters/claude.ts:2444-2453`                                                               | "User interrupted" also matches `errors.includes('interrupt')`, for older CLIs.                                                                                                                 | A real failure mentioning "interrupt" is reported as the user's own cancellation.                                                                  | no             |
| 8   | `provider/adapters/claude.ts:2183-2237`                                                               | Auth state sniffed from undocumented SDK account fields when the CLI answers `unknown`.                                                                                                         | A version-compat branch, in a repository whose policy is none.                                                                                     | no             |
| 9   | `provider/adapters/codex.ts:2143`                                                                     | `PWD` injected into the child env beside `cwd`, uncommented.                                                                                                                                    | Undocumented third-party quirk.                                                                                                                    | no             |

## Decisions

- D1: an unrecognized persistence value means **no persistence**, and the option is shown with its
  own label. Never guess upward. This is the only acceptable default for item 1.
- D2: items 7 and 8 drop old-CLI support instead of keeping the string pass. State the minimum
  Claude CLI version in the provider's availability check and report below it as unsupported.
- D3: for item 5, stderr stops being classified. It is attached to the wide event as opaque
  diagnostics. If Codex has failures that reach only stderr, that is an upstream issue to file, and
  the plan records which ones.

## Phase 1 — permission scope and consent text (items 1, 2)

Map Codex's declared option values explicitly; read `_meta.persist` where present. Unknown values
follow D1. The app name comes from one documented metadata field, else `request.serverName`. Tests
use `MockProviderAdapter` and real elicitation payloads captured from Codex, including an option
whose label contains both "session" and "always".

## Phase 2 — error codes across the adapter boundary (items 3, 4)

Add `provider.REQUEST_GONE` and `provider.NOT_INSTALLED` to the provider error catalog through
`structured-errors.ts`. The adapter raises them; `pending-requests` and the reactor branch on
`code`. Delete both string matchers and the synthesized `'stale pending '` sentence. Runtime facts
(request id, session state) go in `internal`, per the logging rules; `bun run errors:census` must
stay green.

## Phase 3 — identities and versions (items 5 to 9)

Tool kind switches on the SDK's tool identity (`mcp__` prefix plus the native tool enum) and
defaults to `dynamic_tool_call`. Apply D2 and D3. Item 9: pass absolute paths in the request params
as `codexSkillsListParams` already does and drop `PWD`, or keep it with a one-line upstream reason.

## Verification

Narrow server tests per item, run with `bun --bun vitest`. After the deploy, `bun run logs` for one
real Codex approval and one real Claude turn: the wide event carries the code, and no classified
stderr line appears as a user-facing error. "It typechecks" does not cover Phase 1; the both-words
label test does.

## What this plan does not do

It does not change the provider protocol or the approval UI. It does not touch git, which already
reads `--porcelain=v2` and `-z` everywhere and was checked.
