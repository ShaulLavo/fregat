# CLIProxyAPI and native GPT subagents in Claude Code

## Can Opus 5.5 use GPT 6.1 Sol through Claude Code's native Agent tool?

### Takeaway

Yes, the current interfaces provide the necessary path: custom subagent model IDs + Claude Messages to Codex Responses translation. This is a third-party compatibility path, unsupported by Anthropic for non-Claude models. With a session-wide custom endpoint, all parent and child model requests reach that endpoint; preserve the Claude parent's saved subscription login with a thin local model router, or give CLIProxyAPI separate Claude credentials.

### Cited Findings

- Claude Code custom subagents accept a full model ID with the same values as `--model`; per-invocation model wins over agent frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the parent model. The Agent tool runs the actual tool loop using that model. — [Claude subagent docs](https://code.claude.com/docs/en/sub-agents#choose-a-model)
- With a custom `ANTHROPIC_BASE_URL`, Claude Code passes arbitrary model strings through. Full model IDs in subagent frontmatter are checked under the same rules. Opus 5.5 needs Claude Code v2.1.280 or newer. — [Claude model configuration](https://code.claude.com/docs/en/model-config)
- CLIProxyAPI registers a direct Claude -> Codex translator that converts requests, streaming/non-streaming responses, and token counts. — [Translator registration](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/translator/codex/claude/init.go)
- The translator maps tools and tool_choice, tool results, parallel tool calls, thinking effort, service tier, and encrypted reasoning replay. — [Request translator](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/translator/codex/claude/codex_claude_request.go)
- Anthropic explicitly does not support routing Claude Code to non-Claude models through gateways. While a gateway credential variable is active, the saved subscription login is kept locally but is not sent; the gateway needs upstream credentials. — [Official gateway limitations](https://code.claude.com/docs/en/llm-gateway)
- CLIProxyAPI's documented Claude setup uses `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`, and optional gateway model discovery. Its sample also changes permissions and timeout/context knobs; those changes are not required for the proxy connection and should not be copied indiscriminately. — [CLIProxyAPI Claude client setup](https://help.router-for.me/agent-client/claude-code)

### Inferences

- A native agent file can use `model: gpt-6.1-sol`, retaining Claude Code's Read/Edit/Bash/tool lifecycle. This is materially different from a Claude subagent invoking an MCP Codex delegation tool.
- With CLIProxyAPI alone, configure Claude OAuth with `--claude-login` or an Anthropic API credential to serve the Opus parent. A local wrapper gateway can instead forward Claude requests/auth unchanged to Anthropic and send only GPT requests to CLIProxyAPI with its separate local key; that avoids cloning the live Claude refresh token.
- Avoid disguising GPT as `claude-sonnet-*`; custom endpoint support already permits the real model ID and honest reporting.

### Gaps

- No live tool-loop test was run in this research lane. Behavioral compatibility must be checked with a tiny real Agent delegation and a tool call, then the actual reported model in `/tasks` or result `modelUsage`.
- The OAuth-preserving wrapper gateway is a local implementation choice, not a built-in per-subagent endpoint feature.

## How should two existing Codex subscription accounts be authenticated and routed?

### Takeaway

Use separate CLIProxyAPI OAuth logins for durable service ownership, one per account. For an initial test, importing access tokens without refresh tokens works and does not let CLIProxyAPI rotate the source sessions' refresh tokens. Round-robin cold assignments with session stickiness and independent subagent bindings use both accounts without changing account on every turn.

### Cited Findings

- CLIProxyAPI supports Codex OAuth and multiple-account load balancing. — [Project README](https://github.com/router-for-me/CLIProxyAPI)
- Normal Codex login is `./cli-proxy-api --codex-login`, with optional `--no-browser`; callback port is 1455. Claude OAuth similarly uses `--claude-login` with callback port 54545. — [Codex provider](https://help.router-for.me/configuration/provider/codex); [Claude provider](https://help.router-for.me/configuration/provider/claude-code)
- Current CLI flags additionally support `--codex-device-login`; `--config` selects the config whose OAuth auth directory receives the new login. — [CLI flags](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/cmd/server/main.go)
- Credential filenames incorporate account hash plus email/plan when available so same-email accounts can remain separate. — [Codex filenames](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/auth/codex/filename.go)
- Codex credential JSON uses top-level `type: codex`, `id_token`, `access_token`, `refresh_token`, `account_id`, `email`, `plan_type`, `expired`, and `last_refresh`. — [Token schema](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/auth/codex/token.go)
- `CodexExecutor.Refresh` immediately returns the existing auth without network refresh when `refresh_token` is absent; execution credentials fall back to the metadata `access_token`. — [Codex auth executor](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/runtime/executor/codex_executor_auth.go)
- File synthesis reads top-level `plan_type`, falling back to id_token claims if present, and otherwise uses a default plan. An access-only import therefore should explicitly set plan_type so the right catalog is registered. — [Auth file synthesis](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/watcher/synthesizer/file.go)
- Access-token JWT expiry is parsed even if expired metadata is absent. Auto-refresh scheduling stops after an unauthorized auth failure. — [Auth expiry](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/sdk/cliproxy/auth/types.go); [Auto-refresh schedule](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/sdk/cliproxy/auth/auto_refresh_loop.go)
- The refresh implementation serializes concurrent refreshes for the same refresh token within this process, and tests specifically classify refresh_token_reused as nonretryable. This does not coordinate independent Codex CLI processes holding copies. — [Refresh implementation](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/auth/codex/openai_auth.go); [Refresh tests](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/auth/codex/openai_auth_test.go)
- v8 routing has `strategy: round-robin`, `session-affinity`, TTL, and `session-affinity-subagents`. Affinity preserves an account during a session and fails over when unavailable. Subagent affinity true inherits parent account where applicable; false distributes child sessions through the credential selector. — [v8 config](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/config.example.yaml)

### Inferences

- Durable setup: one dedicated proxy OAuth login per account. Do not copy and refresh the tokens concurrently with the live Codex CLI account files.
- Initial access-only auth JSON can be `{"type":"codex","access_token":"<read privately>","account_id":"<account>","email":"<identity>","plan_type":"plus","expired":"<RFC3339>"}`. Omit refresh_token, and use restrictive permissions. The source auth file stays untouched.
- Recommended routing: round-robin; session-affinity true; session-affinity-ttl 1h; session-affinity-subagents false. Each GPT agent remains sticky after assignment while new GPT agents can use either account.
- Access-only credentials expire and must be refreshed externally or replaced by dedicated OAuth logins; this is useful for proving the workflow, not unattended durable operation.

### Gaps

- Actual account quotas and model availability require the user's authenticated service; research does not establish that the two specific accounts are eligible.
- CLIProxyAPI pooling expands available capacity across genuine accounts; it does not remove provider quotas.

## Which current release/config/model IDs should be installed on Linux?

### Takeaway

Pin v8.0.4 and its SHA256 checksum, use v8 nested config, loopback binding, auth data under /work, and leave remote model updates enabled. GPT 6.1 Sol appears in the current remote model catalog although the checked-out embedded catalog still lists GPT 6 Sol.

### Cited Findings

- GitHub latest-release API returned v8.0.4, published 2026-09-29T00:12:47Z, with Linux amd64/aarch64 tarballs and checksums.txt. — [Release v8.0.4](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.4)
- Official quick start supports Linux via installer, Arch AUR, direct release binaries, or Go source build. The installer defaults deserve inspection because the user's workload location is /work. — [Quick start](https://help.router-for.me/introduction/quick-start)
- Checked-out main commit is a270e7b9e57aaecd8f82555f44c2108518ad2330. v8 config groups listener under server, client keys under access.api-keys, OAuth data under oauth.auth-dir, local management under management. Old fields remain compatible, but v8 values win. — [Pinned config template](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/config.example.yaml)
- The help site's basic-config sample still shows legacy top-level host/api-keys/auth-dir and usage-statistics-enabled fields. Prefer the release's own config example for the pinned service. — [Help sample](https://help.router-for.me/configuration/basic)
- The checked-out embedded Codex catalog has gpt-6-sol but lacks gpt-6.1-sol. The remote catalog currently has gpt-6.1-sol for codex-team, codex-plus and codex-pro, with advertised context length 272000, output cap 128000, tools, text/image inputs, low/medium/high/xhigh/max thinking. — [Embedded catalog](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/registry/models/models.json); [Remote catalog](https://raw.githubusercontent.com/router-for-me/models/main/models.json)
- Remote models are refreshed immediately on startup and every three hours. `--local-model` skips remote model fetching, so it would hide this recently added ID unless the embedded catalog has caught up. — [Updater](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/registry/model_updater.go); [CLI flag](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/cmd/server/main.go)
- OAuth aliases under oauth.model-alias rename IDs for listing/routing and do not apply to API-key groups. Model overlap can produce ambiguous routing, so unique names/prefixes are advised. — [Config aliases](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/config.example.yaml)

### Inferences

- Minimal v8 service config: config-version 8; server.host 127.0.0.1; server.port a free local port; access.api-keys one generated local key; oauth.auth-dir /work/<application>/auth; routing as above; management.allow-remote false and control panel disabled for the initial setup.
- Prefer a versioned binary under /work/<application>/releases/8.0.4 and a small user systemd unit pointing to it. Auth/config/logs remain separate from the source repo.
- First verify `/v1/models` really lists gpt-6.1-sol after startup; do not alias gpt-6-sol to that name because it would silently run the wrong model.
- Mesh exposure is a later network integration decision: keep the provider credentials server-side, retain the local key requirement, and expose model API endpoints rather than management/OAuth routes. The local Claude OAuth-preserving wrapper should remain loopback even if the underlying Codex gateway is available on the private mesh.

### Gaps

- No large downloads, install, external config edits, or paid-model calls were performed in this research lane.
- This lane does not review the mesh implementation or configure routes; the coordinator's environment lane owns that assessment.
