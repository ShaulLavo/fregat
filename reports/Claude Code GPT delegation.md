# Give Claude Code native GPT subagents

Historical installation evidence from 2026-09-29. On 2026-10-03 the gateway usage producer was retired from source and the remaining tooling moved to plain files under `/work/cli-proxy-api/src`. The installed runtime was untouched by source retirement; the addresses and checks below describe the original verification.

**The requested setup is installed and verified: launch `claude-gpt`, keep Opus as the main model, and ask it to delegate to the `sol` agent running `gpt-6.1-sol`.** A live check confirmed Opus 5.5 invoked Claude Code's Agent tool, Sol executed a shell tool, and its result returned to Opus successfully. CLIProxyAPI translates GPT requests into Codex requests, while a small local dispatcher forwards Claude requests to Anthropic using the existing Claude login. Both Codex accounts now have independent proxy-owned logins. Mesh starts and stops the service and exposes the authenticated model API privately. Anthropic documents the underlying gateway mechanisms while explicitly excluding non-Claude models from support. ([Live evidence summary](/work/projects/platform/reports/Claude%20Code%20GPT%20delegation%20evidence.md))

## The `sol` agent keeps Claude Code's interface

Claude Code supports a full model ID in custom subagent definitions. The installed definition names the agent `sol` and sets `model: gpt-6.1-sol`; its description covers implementation, debugging, analysis, and independent review. Opus can select that agent through the normal Agent tool, and GPT receives the tools Claude Code makes available to it. This is the workflow requested after the clarification that CLI delegation already exists. ([Claude subagents](https://code.claude.com/docs/en/sub-agents))

Use the scoped launcher from the project you want to work on:

```bash
cd /work/projects/platform
claude-gpt
```

Then ask: “Delegate this review to the sol agent.” The launcher forwards additional Claude arguments, so `claude-gpt --model opus` also works. It supplies the agent definition for that session and sets only `ANTHROPIC_BASE_URL=http://127.0.0.1:8318`. The ordinary `claude` command and existing model defaults retain their configuration. ([Installed setup documentation](/work/cli-proxy-api/src/AGENTS.md))

The dispatcher routes model IDs beginning with `claude-` directly to `https://api.anthropic.com`, retaining the request body, Claude authorization, beta headers, and response stream. It routes IDs beginning with `gpt-` to CLIProxyAPI, replacing authorization with the generated proxy client key and removing Claude API-key and cookie headers. This prevents the GPT branch from receiving Claude credentials. Anthropic's gateway documentation confirms that a custom base URL can retain claude.ai authentication when no gateway credential variable overrides it. ([Local dispatcher](/work/cli-proxy-api/src/gateway.ts); [Gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol))

CLIProxyAPI supplies the translation between Claude Messages and Codex Responses, including tools, tool results, streaming responses, and reasoning-related fields. The exact `gpt-6.1-sol` ID appears in the local Codex catalog and in the installed proxy's authenticated model catalog, including through mesh. No older GPT model was renamed to impersonate Sol. ([Request translator](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/translator/codex/claude/codex_claude_request.go); [Codex model catalog](/home/shaul/.codex/models_cache.json))

## Both Codex accounts are connected

Both accounts completed separate OpenAI device sign-ins into CLIProxyAPI. Their credential files carry different account IDs and have permissions `0600`. CLIProxyAPI owns their refresh lifecycle, independently of the normal Codex CLI login. Logging out or switching accounts in Codex therefore leaves this pool available. No original Codex refresh token was copied. ([Installed setup documentation](/work/cli-proxy-api/src/AGENTS.md); [Codex authentication](https://learn.chatgpt.com/docs/auth))

For another independent proxy login, use:

```bash
cli-proxy-login
```

The command prints a device sign-in URL and code. Open it from any browser, enter the code, and sign into the second account. It works remotely without a localhost callback. This creates a separate CLIProxyAPI-owned login, which the proxy can refresh itself. The helper uses `-no-browser` and leaves browser access to the remote user. Both existing accounts are already authorized; no additional sign-in is currently needed. ([Installed setup documentation](/work/cli-proxy-api/src/AGENTS.md); [CLIProxyAPI Codex login](https://help.router-for.me/configuration/provider/codex))

The configured pool uses round-robin assignment for new conversations and session affinity within a conversation. GPT subagents can receive independent account assignments, and unavailable credentials can fail over. **The pool adds the available capacity of the signed-in accounts; each account keeps its provider quota and model eligibility.** The running service was restarted with both distinct account credentials loaded. An isolated access-only request to `gpt-6.1-sol` through the second account returned HTTP `429` with `usage_limit_reached`. The account is authenticated but currently has no usable quota for that request. The original account passed the native Agent check; the shared pool is configured to try another credential on quota failure. Forced failover and quota-reset recovery were not exercised. ([CLIProxyAPI routing configuration](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/config.example.yaml))

## Mesh manages the service and private access

CLIProxyAPI **v8.0.4** is installed under `/work/cli-proxy-api`, with the release archive's published SHA256 verified. The checked archive hash is `f396653cd60cd20494705c22193d11878dce101687bb7d060871c163a5735bb6`. Configuration, credentials, and the generated client key stay outside Git. The retained dispatcher source is locally owned under `/work/cli-proxy-api/src`, outside Fregat. ([Release](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.4); [Setup documentation](/work/cli-proxy-api/src/AGENTS.md))

Mesh owns both processes, starts them on demand, and stops them after **15 minutes idle**. CLIProxyAPI is available locally at `http://127.0.0.1:8317` and privately at `https://omarchy.mesh.shaulavo.dev/ai`; both require the generated client key. The Claude dispatcher stays on `127.0.0.1:8318`. Management and the management panel are disabled. This gives other trusted clients a shared Codex inference endpoint while keeping Claude subscription forwarding local. ([Setup documentation](/work/cli-proxy-api/src/AGENTS.md))

Use `mesh serve ls` to inspect the route and `mesh serve stop /ai` to stop it; the next connection starts it again. That is enough mesh integration for this workflow. Adding gateway selection to Platform's provider settings would be separate application work, with explicit secret ownership and provider configuration. The standalone route already supports the native Claude Code objective without changing Platform's chat interface.

## Alternatives solve different parts of the workflow

The comparison below covers current documented capabilities, not a performance benchmark. CLIProxyAPI is the best fit here because subscription pooling and actual GPT model requests inside Claude's agent interface are the central requirements.

| Option                               | Useful for                                                              | Fit here                                               |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| CLIProxyAPI plus local dispatcher    | Codex subscriptions, account pooling, Claude Messages translation       | Installed path to native Sol subagents                 |
| Claude Code Router                   | GUI management, provider routing, credential pools, request diagnostics | Broader control plane; adds another service            |
| LiteLLM                              | API-key providers, shared budgets, virtual keys                         | Its documented Claude setup requires provider API keys |
| `codex exec` or a custom MCP wrapper | Delegation using saved Codex login, JSONL output, resumable threads     | Available fallback; already familiar to the user       |
| Codex app-server bridge              | Sessions, streamed events, approvals, account and quota reads           | Larger integration against an experimental protocol    |

Claude Code Router now supports several agent clients, protocol formats, routing rules, and credential pools. Its README says local login import works where supported; this research did not establish two-account Codex import for the specific installed environment. LiteLLM documents non-Anthropic models through an Anthropic-compatible endpoint, but that API-key-oriented recipe does not itself pool the existing Codex subscriptions. ([Claude Code Router](https://github.com/musistudio/claude-code-router); [LiteLLM tutorial](https://docs.litellm.ai/docs/tutorials/claude_non_anthropic_models))

Old guides recommending **`codex mcp-server` are obsolete**: OpenAI removed that command, and installed Codex CLI 0.159.0 has no such subcommand. `codex exec` still reuses saved login and supports machine-readable output and resume. App-server is the replacement integration foundation, but it speaks its own JSON-RPC protocol and needs an adapter for MCP clients. ([MCP removal](https://learn.chatgpt.com/docs/mcp-server); [Non-interactive Codex](https://learn.chatgpt.com/docs/non-interactive-mode))

## Verification and account policy remain explicit

The completed checks establish authenticated model discovery locally and through mesh, rejection of unauthenticated requests with `401`, disabled management with `404`, three passing gateway tests, and passing script TypeScript checks. The tests cover Claude authorization/header/body/stream preservation, GPT credential replacement, and invalid requests. **The live check confirmed parent `claude-opus-5-5` invoked `Agent` with `subagent_type: sol`, child `gpt-6.1-sol` ran `Bash` successfully, and the Agent handback completed.** This verifies native delegation through the canonical transcript; no interactive terminal screenshot was inspected. Claude emits an unrecognized-model warning but succeeds. Its cross-provider cost display has unknown cost basis and should not be treated as invoice evidence. ([Dispatcher tests](/work/cli-proxy-api/src/gateway.test.ts); [Live evidence summary](/work/projects/platform/reports/Claude%20Code%20GPT%20delegation%20evidence.md))

The account-ban concern has no defensible guarantee. Anthropic permits an end user to sign into the unmodified Claude Code binary using their own subscription, restricts third-party collection or intermediation of Claude credentials, and excludes non-Claude gateway routing from official support. This setup retains native sign-in and forwards credentials locally without storing a Claude token in CLIProxyAPI. Those facts explain the design; they do not establish Anthropic approval of the mixed-model workflow or immunity from enforcement. A custom base URL also disables Claude Remote Control. ([Authentication policy](https://code.claude.com/docs/en/legal-and-compliance); [Gateway support limits](https://code.claude.com/docs/en/llm-gateway); [Remote Control limitation](https://code.claude.com/docs/en/llm-gateway-connect))
