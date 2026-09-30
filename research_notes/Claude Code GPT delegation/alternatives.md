# Alternatives for Claude Code delegating GPT-6.1-Sol

## Can Opus 5.5 run GPT-6.1-Sol as a native Claude Code subagent?

### Takeaway

Yes as an engineering integration: give the custom subagent `model: gpt-6.1-sol` and route the Anthropic Messages protocol through a translating gateway. Anthropic explicitly excludes non-Claude model routing from support, so this should be treated as a third-party integration that needs a live tool-use check.

### Cited Findings

- Claude Code subagent `model` accepts aliases, `inherit`, or a full model ID; per-invocation model overrides definition frontmatter, then the environment variable, then the main model. A subagent has its own context and tool permissions. — [Anthropic subagents](https://code.claude.com/docs/en/sub-agents)
- Anthropic says gateways exposing a supported format work, while routing Claude Code to non-Claude models is unsupported. — [Anthropic gateway overview](https://code.claude.com/docs/en/llm-gateway)
- A custom `ANTHROPIC_BASE_URL` makes Claude Code send Anthropic Messages requests. Unrecognized models receive current Claude capability fields, so the gateway must handle adaptive thinking, effort, and context-management differences. — [Gateway compatibility](https://code.claude.com/docs/en/llm-gateway-protocol)
- With `ANTHROPIC_BASE_URL` and no gateway credential variables, Claude Code can keep claude.ai login. Forward `anthropic-beta` verbatim because subscription requests include a required OAuth capability. Preserve the upstream stream and keep-alive pings. — [Gateway compatibility](https://code.claude.com/docs/en/llm-gateway-protocol)
- Remote Control is disabled when the base URL points at a non-Anthropic host; gateway credentials also affect voice access. — [Gateway connection guide](https://code.claude.com/docs/en/llm-gateway-connect)
- The exact slug `gpt-6.1-sol`, display name `GPT-6.1-Sol`, exists in the local catalog, fetched `2026-09-29T20:03:37.984462347Z`. — [Local Codex model catalog](/home/shaul/.codex/models_cache.json)

### Inferences

- The closest match to the requested workflow is a small local dispatcher: requests naming a Claude model pass through to Anthropic with the incoming subscription authorization; requests naming GPT go to CLIProxyAPI's Anthropic-compatible endpoint. The dispatcher must replace the credential on GPT requests so a Claude token never reaches the Codex proxy.
- Keeping dispatch local avoids exporting the Claude OAuth credential to a remote mesh gateway. CLIProxyAPI itself can be reachable through the private mesh when other trusted machines need its Codex pool.
- Avoid changing default Opus/Haiku aliases to GPT globally. Define an explicit named GPT agent and preserve Opus as the main conversation's model.

### Gaps

- Documentation confirms full IDs but does not promise arbitrary non-Claude IDs succeed end to end. A real subagent call that invokes a filesystem tool is needed before calling the integration finished.
- The local Codex catalog proves the requested ID is real locally; it does not prove CLIProxyAPI's static catalog exposes or understands it. Verify the proxy catalog and translation on the installed release.
- Default 200K context assumptions for unknown gateway IDs can understate or overstate the real model limit. The gateway guide offers custom model context configuration; validate against the real catalog before tuning it.

## What are the useful alternatives, including current Codex delegation?

### Takeaway

CLIProxyAPI fits subscription pooling and literal GPT subagents best. For delegation that keeps Claude's networking untouched, the smallest supported building block is `codex exec`; the old official `codex mcp-server` has been removed and cannot be used on this machine.

### Cited Findings

- OpenAI's current migration page says `codex mcp-server` and the standalone MCP server binary were removed. App-server speaks its own JSON-RPC protocol, is not an MCP replacement, and is experimental. — [Codex MCP removal](https://learn.chatgpt.com/docs/mcp-server)
- Installed CLI reports `codex-cli 0.159.0`; its command list includes `exec`, `mcp` for external MCP servers, and `app-server`, but no `mcp-server`. — Local read-only verification: `codex --version`, `codex mcp-server --help`, `codex exec --help` on 2026-09-29.
- `codex exec` reuses saved CLI authentication. It can emit JSONL events, write the final response with `--output-last-message`, accept a response schema, and resume a thread. — [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- App-server exposes account reads, OAuth login, rate-limit reads, and experimental externally managed ChatGPT tokens with host-driven refresh. — [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- CLIProxyAPI exposes OpenAI/Gemini/Claude/Codex-compatible APIs around CLI providers and advertises Codex subscription support. Its ecosystem includes native Claude Code workflows through an Anthropic-compatible local sidecar. — [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
- Claude Code Router has become a broad local gateway/control plane: OpenAI Chat and Responses, Anthropic Messages, protocol discovery, local login import where supported, credential pools, retries, ordered fallbacks, and request diagnostics. Its CLI requires Node 22+. — [Claude Code Router](https://github.com/musistudio/claude-code-router)
- LiteLLM documents Claude Code using non-Anthropic models through `/v1/messages`, `ANTHROPIC_BASE_URL`, and a proxy credential. Its demonstrated providers use API keys; model discovery can add gateway models to the Claude picker. — [LiteLLM tutorial](https://docs.litellm.ai/docs/tutorials/claude_non_anthropic_models)

### Inferences

| Option                                   | Fit for this request                                                                  | Main tradeoff                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CLIProxyAPI plus local Claude dispatcher | Best for an actual `Agent` invocation running GPT and the two-account Codex pool      | Protocol translation must retain tool calls, streaming, and reasoning behavior                                       |
| Claude Code Router                       | Useful when a GUI, richer policy, request diagnostics, or many providers are desired  | Adds another control plane; Codex login import specifics need release-specific verification                          |
| LiteLLM                                  | Useful for paid API keys, shared budgets, and enterprise provider routing             | The documented setup does not solve the existing two Codex subscriptions by itself                                   |
| Claude Bash invoking `codex exec`        | Simplest delegation preserving both native login systems                              | GPT runs inside Codex's agent harness; it is a Claude tool invocation rather than Claude's own model-driven subagent |
| Small MCP wrapper around `codex exec`    | Clean named GPT tool in Claude with session resume                                    | Custom wrapper ownership; do not mistake it for the removed official Codex MCP server                                |
| MCP wrapper around Codex app-server      | Best when streaming events, approvals, sessions, cancellation, and quota reads matter | Larger integration against an experimental protocol; Platform may already own comparable integration                 |

- Start with the CLIProxyAPI route the user requested. Keep `codex exec` as the small fallback if gateway translation proves brittle rather than adding both integrations immediately.
- A custom MCP wrapper should launch the official CLI, inherit its authentication, and pass prompts through stdin or structured arguments. It need not read or implement OAuth tokens itself.

### Gaps

- No paid model call was run during research.
- No current Claude Code Router Codex OAuth-import guide was inspected; the README promises local import only "where supported," so this is not verified to pool these exact two accounts.
- No performance or fidelity comparison was measured. The table compares documented capabilities and engineering scope.

## How should the two Codex accounts and mesh fit together?

### Takeaway

Keep a single explicit owner for each account's token refresh. CLIProxyAPI provides the natural inference pool, while official CLI delegation can isolate accounts in separate `CODEX_HOME` directories; the mesh should provide private reachability and lifecycle, not hold duplicate refresh-token copies throughout the fleet.

### Cited Findings

- Official auth docs support cached ChatGPT login, automatic refresh during use, and file, keyring, auto, or ephemeral credential storage. File credentials live under `CODEX_HOME`. — [Codex authentication](https://learn.chatgpt.com/docs/auth)
- `CODEX_HOME` owns config, auth, history, and other local state. — [Advanced Codex configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)
- App-server can report per-account ChatGPT rate limits and can use host-owned experimental token refresh. — [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- Claude requests carry session and spawned-agent IDs, while optional gateway hints classify main, subagent, compaction, and auxiliary requests. — [Gateway compatibility](https://code.claude.com/docs/en/llm-gateway-protocol)

### Inferences

- For CLI delegation, select accounts with an explicit per-process home: one account can keep the existing home and the second can live beside the service under `/work`. `--profile` changes configuration within a home; it does not create a second independent login store.
- Avoid two unrelated programs refreshing copies of the same refresh token unless their sharing is proven safe. Let the official CLI retain its current login, and independently complete proxy login when appropriate instead of silently copying authentication files.
- Mesh integration is justified for service lifecycle, private HTTPS access, and routing other trusted clients to the Codex pool. Keep management endpoints loopback-only, use an explicit client key for remote inference, and place a small per-client Claude dispatcher locally so Claude authorization does not cross the network.
- Platform-specific provider support is a separate follow-up: expose the gateway as a machine/application-scoped provider with secret storage and the existing agent adapters. Running a standalone mesh service does not require modifying Platform's provider code.
- Attribute service logs using session/agent IDs and model names without recording headers or prompts. This makes native GPT delegation observable while keeping credentials out of logs.

### Gaps

- Exact local mesh CLI/service conventions and the second account's existing storage location are assigned to other research lanes; they were not inspected in this alternatives lane.
- Automatic balancing across two official CLI homes is a custom policy. A simple account selector is the smallest initial implementation; CLIProxyAPI is the better starting point for an inference pool.
