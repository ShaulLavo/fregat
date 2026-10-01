# Claude Code with GPT subagents

The `claude-gpt` launcher sets a local Messages gateway for one Claude Code session. The gateway forwards Claude requests unchanged to Anthropic using the existing Claude login. GPT models go through CLIProxyAPI's Messages-to-Codex translation. The `sol` agent uses the real `gpt-6.1-sol` model ID and Claude Code's agent tool loop.

Installation on this machine lives at `/work/cli-proxy-api`. Mesh owns the process, starts it on demand, and stops it after 15 minutes idle. The launcher does not change the normal `claude` command or shared agent instructions.

```bash
claude-gpt
# Ask: "Delegate this review to the sol agent."

mesh serve ls
# Before stopping, wait until no agents are mid-request.
mesh serve stop /ai
```

`http://127.0.0.1:8318` is the local Claude dispatcher. `http://127.0.0.1:8317` and `https://omarchy.mesh.shaulavo.dev/ai` expose CLIProxyAPI, authenticated by its generated client key. The dispatcher stays local. CLIProxyAPI management, discovery, and the management panel are disabled.

## Local gateway boundary

Claude Code is the intended caller. The launcher sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8318`. Every endpoint, including `/health`, rejects `Origin` and `Sec-Fetch-Site`, and accepts only the loopback hostnames `127.0.0.1`, `localhost`, or `[::1]`, case-insensitively, with optional port and a DNS trailing dot on the IPv4 or localhost name. `Sec-Fetch-Mode` alone is accepted, including the `cors` header sent by Node's built-in fetch. Tests exercise both Node HTTP Host construction and a real Node fetch request. Same-user local processes remain trusted because they can read the proxy key file.

Mesh preserves incoming Host, so the hostname-only boundary works across public/backend port changes. [Mesh's on-demand readiness check](https://github.com/ShaulLavo/mesh/blob/main/docs/serve-on-demand.md) waits for both upstream TCP ports to accept connections. It does not call `/health`. The runner starts CLIProxyAPI and binds the gateway immediately. Claude requests can proceed while the GPT registry loads or remains unavailable. Binding failures, child exit, and termination signals close the dispatcher and clean up its owned proxy child. Cleanup waits one second after SIGTERM, then escalates to SIGKILL with a final one-second wait and a structured failure diagnostic if the child remains alive.

`/health` checks the authenticated `/v1/models` registry on every call, with a 250 ms deadline. It returns 200 only when the proxy lists GPT models, and a JSON Messages error with status 503 while the registry is unavailable. A GPT request with no ready registry waits up to 15 seconds for its requested model. Startup and recovery probes allow up to one second per catalog read within the overall deadline. A responding GPT catalog that keeps omitting the requested model throughout the wait produces a clear 400 with model-access guidance; an unavailable registry produces 503. Normal responses and SSE streams pass through unchanged.

An HTTP 400 `unknown provider for model` response triggers a fresh registry check after bounded error inspection. Inspection accepts a complete body up to 64 KiB within one second; oversized, incomplete, or failed body reads are canceled and return 502 with inspection-limit guidance. Only a complete, recognized error can lead to replay. An absent requested model opens a 15-second recovery wait, including catalogs that already list other GPT models. The gateway waits within that window and replays the original request at most once. Model lookup follows CLIProxyAPI v8.0.4: strip the final parenthesized thinking suffix, trim the base name, and fall back to the full registered name. Forwarding preserves the original model and request bytes.

A loaded registry also allows one replay within the gateway's initial 15-second startup window. In a long-running gateway, a catalog that already lists the requested model leaves the original provider error intact; recovery requires an observed registry gap. Other request errors pass through. The first failed wait logs one warning, recovery logs an info event with the failed-wait count, and an exhausted unavailable-registry wait logs `gave-up`. Connection failures retain the gateway's 502 error handler.

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

Before rebuilding and reloading, wait until no agents are mid-request. Rebuild after source changes with `bun build scripts/claude-gpt/run.ts --target bun --outfile /work/cli-proxy-api/gateway.js`, then `mesh serve stop /ai` so the next connection starts the update. Configuration and credentials remain outside Git.
