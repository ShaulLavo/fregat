# Claude Code with GPT subagents

The `claude-gpt` launcher sets a local Messages gateway for one Claude Code session. The gateway forwards Claude requests unchanged to Anthropic using the existing Claude login. GPT models go through CLIProxyAPI's Messages-to-Codex translation. The `sol` agent uses the real `gpt-6.1-sol` model ID and Claude Code's agent tool loop.

Installation on this machine lives at `/work/cli-proxy-api`. Mesh owns the process, starts it on demand, and stops it after 15 minutes idle. The launcher does not change the normal `claude` command or shared agent instructions.

```bash
claude-gpt
# Ask: "Delegate this review to the sol agent."

mesh serve ls
mesh serve stop /ai
```

`http://127.0.0.1:8318` is the local Claude dispatcher. `http://127.0.0.1:8317` and `https://omarchy.mesh.shaulavo.dev/ai` expose CLIProxyAPI, authenticated by its generated client key. The dispatcher stays local. CLIProxyAPI management, discovery, and the management panel are disabled.

## Local gateway boundary

Claude Code is the intended caller. The launcher sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8318`. Every endpoint, including `/health`, rejects `Origin` and `Sec-Fetch-Site`, and accepts only the loopback hostnames `127.0.0.1`, `localhost`, or `[::1]`, case-insensitively, with optional port and a DNS trailing dot on the IPv4 or localhost name. `Sec-Fetch-Mode` alone is accepted, including the `cors` header sent by Node's built-in fetch. Tests exercise both Node HTTP Host construction and a real Node fetch request. Same-user local processes remain trusted because they can read the proxy key file.

Mesh preserves incoming Host, so the hostname-only boundary works across public/backend port changes. Mesh gates the whole `/ai` route on both upstream ports accepting, so Claude requests can wait at the mesh layer during cold startup.

The gateway binds immediately. Until the proxy is known ready, each GPT request and `/health` re-probes for up to 250 ms, returns a JSON Messages error with status 503 if still unavailable, and records successful readiness for later requests. The first failed wait logs one structured warning; later recovery logs one structured info event with the failed-wait count. Claude forwarding never waits inside the gateway. A later upstream connection failure still uses the gateway's 502 error handler.

Request bodies are capped at 32 MiB, matching Anthropic's [32 MB Messages request limit](https://platform.claude.com/docs/en/api/overview#request-size-limits). The cap is enforced by `Bun.serve` before body parsing. The idle timeout remains disabled so quiet, long-lived SSE operations retain their connection; streams pass through as chunks arrive.

Both directions strip fixed hop-by-hop headers and headers nominated by `Connection`. GPT forwarding allows only `content-type`, `accept`, `anthropic-version`, `anthropic-beta`, `x-claude-code-session-id`, `x-claude-code-agent-id`, and `x-claude-code-parent-agent-id`, then sets the proxy Authorization key. Claude credentials and other client headers are excluded from the GPT path. The Claude path retains end-to-end headers and original body bytes.

The three affinity headers are documented in CLIProxyAPI v8.0.4 source: [session identity extraction](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.4/sdk/cliproxy/session/info.go) and [Claude execution scope](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.4/internal/runtime/executor/helps/claude_code_session.go). Body `metadata.user_id` also provides Claude session identity and passes through unchanged. Generic Codex and other-client affinity headers are outside this Claude Code-only interface.

The launcher reads and validates its agent definitions before executing Claude; missing, unreadable, or empty definitions stop startup with a diagnostic.

The install uses CLIProxyAPI v8.0.4, with the published archive SHA256 checked. Source is `gateway.ts` and `run.ts`; `run.ts` is bundled into the install's `gateway.js`.

Both accounts have independently authorized credentials in `/work/cli-proxy-api/auth`, with file permissions `0600`. CLIProxyAPI owns their refresh lifecycle. The gateway has no dependency on the official Codex login or its auth file. Logging out or switching accounts in Codex leaves this pool available.

The second account's verification request returned `429 usage_limit_reached`, so its inference quota must reset before it can contribute capacity. The original account passed the native Sol agent check. For another independent proxy login, run:

```bash
cli-proxy-login
```

The command prints an OpenAI device sign-in URL and a short code. Open the URL from any browser, enter the code, and choose the other ChatGPT account. Device login works remotely without a localhost callback or SSH tunnel. These separately authorized credentials belong to CLIProxyAPI and it refreshes them itself. Each independent account joins the pool. Account logins are kept by the proxy. The helper uses `-no-browser`, so it prints remote sign-in instructions without launching a browser on the host.

Round-robin routing distributes new conversations. Session affinity retains an account within a conversation; GPT subagents can receive separate account bindings. An unavailable account can fail over to another account. Account limits and model access remain the provider's limits.

Anthropic documents custom model IDs but excludes non-Claude gateway models from official support. This integration is experimental. Custom `ANTHROPIC_BASE_URL` sessions also disable Claude Remote Control. GPT runs with Claude's agent harness; Codex-specific tooling and session recovery belong to Codex itself.

A live check on 2026-09-29 verified `claude-opus-5-5` invoking `Agent` with `subagent_type: sol`, the child responding as `gpt-6.1-sol`, executing `Bash` with `pwd`, and returning its result to Opus. This proves the native Agent path. The interactive subagent panel was not visually inspected. Claude emits an `unrecognized_model` diagnostic for GPT while the agent succeeds; its estimated costs and default context metadata for GPT may differ from Codex's catalog and subscription billing.

Rebuild after source changes with `bun build scripts/claude-gpt/run.ts --target bun --outfile /work/cli-proxy-api/gateway.js`, then `mesh serve stop /ai` so the next connection starts the update. Configuration and credentials remain outside Git.
