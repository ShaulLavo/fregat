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
