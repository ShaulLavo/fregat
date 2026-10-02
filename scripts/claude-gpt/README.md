# Claude Code with GPT subagents and a Claude account pool

The `claude-gpt` launcher sets a local Messages gateway for one Claude Code session. Native Claude Code requests go to a pool of Claude accounts held by a loopback-only CLIProxyAPI instance. Other Claude requests go unchanged to Anthropic with the session's own Claude login. GPT models go through CLIProxyAPI's Messages-to-Codex translation. The `sol` agent uses the real `gpt-6.1-sol` model ID and Claude Code's agent tool loop.

Installation on this machine lives at `/work/cli-proxy-api`. Mesh owns the process, starts it on demand, and stops it after 15 minutes idle. The launcher does not change the normal `claude` command or shared agent instructions.

```bash
claude-gpt
# Ask: "Delegate this review to the sol agent."

mesh serve ls
# Before stopping, wait until no agents are mid-request.
mesh serve stop /ai
```

`http://127.0.0.1:8318` is the local Claude dispatcher. `http://127.0.0.1:8317` and `https://omarchy.mesh.shaulavo.dev/ai` expose the GPT CLIProxyAPI instance, authenticated by its generated client key. The dispatcher stays local. The Claude instance listens on `127.0.0.1:18319` with its own client key and is on no mesh route, so tailnet clients holding the `/ai` key cannot reach the Claude accounts. The runner starts and stops both instances with the gateway. Management APIs are enabled on loopback only (`allow-remote: false`); both instances share the key in `/work/cli-proxy-api/management-key`. Only the GPT instance serves the panel.

## Claude account pool

The Claude instance (`/work/cli-proxy-api/claude/config.yaml`, logins in `/work/cli-proxy-api/claude/auth`) holds one OAuth login per Claude subscription, and CLIProxyAPI refreshes their tokens while the route runs. A Claude request goes to the pool when it carries `x-app: cli`, a `claude-cli/2.1.x` User-Agent at or above the proxy's 2.1.280 baseline whose entrypoint is listed in `runtime.json` `claudePoolEntrypoints`, the `claude-code-20250219` beta, and a well-formed `metadata.user_id` (count_tokens needs none). Interactive `claude-gpt` sends `cli`, `claude -p` sends `sdk-cli`, the VS Code extension `claude-vscode`, and Agent SDK hosts such as T3 Code and Fregat chats send `sdk-ts`. Haiku helper requests omit the claude-code beta and always go direct, as does any entrypoint not on the list.

Without `claudePoolEntrypoints` the list is `cli`, `sdk-cli` and `claude-vscode`: the entrypoints CLIProxyAPI v8.0.4 [confirms as native](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.4/internal/runtime/executor/helps/claude_client_detection.go) and passes through untouched apart from the selected login's identity. This install adds `sdk-ts`. The proxy does not confirm `sdk-ts`, so the Claude instance sets `oauth.providers.claude.disable-claude-cloak-mode: true` to keep those requests uncloaked. The prompt, system and billing blocks, model, tool names and cache markers then pass unchanged. For OAuth logins the proxy still replaces an unconfirmed caller's header fingerprint: the User-Agent becomes `claude-cli/2.1.280 (external, cli)`, the `x-stainless` package, OS and architecture become the proxy baseline, the betas are reordered, and `x-claude-code-session-id` becomes a derived UUID. To return to native-only pooling, delete `sdk-ts` from `claudePoolEntrypoints` (or the whole key), then stop the route as described below. Cloaking with its default `auto` mode would also move system blocks, alias tool names and add an Opus fallback, so leave the flag on while `sdk-ts` is listed.

The pool path forwards exactly the caller headers the proxy reads for detection: `content-type`, `accept`, `accept-encoding`, `user-agent`, `x-app`, `x-client-request-id`, `x-client-app`, `x-anthropic-additional-protection`, and the `anthropic-*`, `x-stainless-*`, `x-claude-code-*` and `x-claude-remote-*` families. It replaces Authorization with the Claude instance key. Claude Code's own Authorization, `x-api-key` and cookies never reach the proxy. The body is forwarded byte for byte; the proxy swaps `metadata.user_id`'s device and account to the selected login, as it does for every pooled request.

Session affinity keeps a conversation, subagents included, on one login. If the Claude instance refuses the connection or fails before any response, or answers `unknown provider for model` because its registry lacks the model, the gateway sends that request to Anthropic with Claude Code's own login and logs one `claude-pool` `warn` per failure series, then an `info` with the count once the pool answers again. Rate limits, 4xx and 5xx answers from the pool pass through unchanged; failover between logins belongs to the proxy, which cools a login down after a 429.

To add a Claude subscription, make sure the route is up (`curl -s http://127.0.0.1:8318/health`), then ask the Claude instance for a sign-in URL:

```bash
curl -s -H "Authorization: Bearer $(cat /work/cli-proxy-api/management-key)" \
  'http://127.0.0.1:18319/v0/management/anthropic-auth-url?is_webui=true' | jq -r .url
```

Open the URL in any browser and sign in with the other Claude account. The browser then fails to load `http://localhost:54545/callback?...` because that address is on omarchy. Copy that whole URL and, within five minutes, deliver it on omarchy with `curl -L '<copied URL>'`. The new login appears in `/work/cli-proxy-api/claude/auth` and joins the pool.

## Local gateway boundary

Claude Code is the intended caller. The launcher sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8318`. Every endpoint, including `/health`, rejects `Origin` and `Sec-Fetch-Site`, and accepts only the loopback hostnames `127.0.0.1`, `localhost`, or `[::1]`, case-insensitively, with optional port and a DNS trailing dot on the IPv4 or localhost name. `Sec-Fetch-Mode` alone is accepted, including the `cors` header sent by Node's built-in fetch. Tests exercise both Node HTTP Host construction and a real Node fetch request. Same-user local processes remain trusted because they can read the proxy key file.

Mesh preserves incoming Host, so the hostname-only boundary works across public/backend port changes. [Mesh's on-demand readiness check](https://github.com/ShaulLavo/mesh/blob/main/docs/serve-on-demand.md) waits for both upstream TCP ports to accept connections. It does not call `/health`. The runner starts both CLIProxyAPI instances and binds the gateway immediately. Claude requests never wait on the GPT registry, and GPT requests never wait on the Claude instance; a Claude request that arrives before the Claude instance accepts takes the direct fallback. Binding failures, child exit, and termination signals close the dispatcher and clean up its owned proxy child. Cleanup waits one second after SIGTERM, then escalates to SIGKILL with a final one-second wait and a structured failure diagnostic if the child remains alive.

`/health` checks the authenticated `/v1/models` registry on every call, with a 250 ms deadline. It returns 200 only when the proxy lists GPT models, and a JSON Messages error with status 503 while the registry is unavailable. A GPT request with no ready registry waits up to 15 seconds for its requested model. Startup and recovery probes allow up to one second per catalog read within the overall deadline. A responding GPT catalog that keeps omitting the requested model throughout the wait produces a clear 400 with model-access guidance; an unavailable registry produces 503. Normal responses and SSE streams pass through unchanged.

An HTTP 400 `unknown provider for model` response triggers a fresh registry check after bounded error inspection. Inspection accepts a complete body up to 64 KiB within one second; oversized, incomplete, or failed body reads are canceled and return 502 with inspection-limit guidance. Only a complete, recognized error can lead to replay. An absent requested model opens a 15-second recovery wait, including catalogs that already list other GPT models. The gateway waits within that window and replays the original request at most once. Model lookup follows CLIProxyAPI v8.0.4: strip the final parenthesized thinking suffix, trim the base name, and fall back to the full registered name. Forwarding preserves the original model and request bytes.

A loaded registry also allows one replay within the gateway's initial 15-second startup window. In a long-running gateway, a catalog that already lists the requested model leaves the original provider error intact; recovery requires an observed registry gap. Other request errors pass through. The first failed wait logs one warning, recovery logs an info event with the failed-wait count, and an exhausted unavailable-registry wait logs `gave-up`. Connection failures retain the gateway's 502 error handler.

Request bodies are capped at 32 MiB, matching Anthropic's [32 MB Messages request limit](https://platform.claude.com/docs/en/api/overview#request-size-limits). The cap is enforced by `Bun.serve` before body parsing. The idle timeout remains disabled so quiet, long-lived SSE operations retain their connection; streams pass through as chunks arrive.

Both directions strip fixed hop-by-hop headers and headers nominated by `Connection`. GPT forwarding allows only `content-type`, `accept`, `anthropic-version`, `anthropic-beta`, `x-claude-code-session-id`, `x-claude-code-agent-id`, and `x-claude-code-parent-agent-id`, then sets the proxy Authorization key. Claude credentials and other client headers are excluded from the GPT path. The Claude pool path is described above; the direct Claude path retains end-to-end headers and original body bytes.

The three affinity headers are documented in CLIProxyAPI v8.0.4 source: [session identity extraction](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.4/sdk/cliproxy/session/info.go) and [Claude execution scope](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.4/internal/runtime/executor/helps/claude_code_session.go). Body `metadata.user_id` also provides Claude session identity and passes through unchanged. Generic Codex and other-client affinity headers are outside this Claude Code-only interface.

The launcher reads and validates its agent definitions before executing Claude; missing, unreadable, or empty definitions stop startup with a diagnostic.

The install uses CLIProxyAPI v8.0.4, with the published archive SHA256 checked. Source is `gateway.ts`, `reset-order.ts` and `run.ts`; `run.ts` is bundled into the install's `gateway.js`.

Both ChatGPT accounts have independently authorized credentials in `/work/cli-proxy-api/auth`, with file permissions `0600`. CLIProxyAPI owns their refresh lifecycle. The gateway has no dependency on the official Codex login or its auth file. Logging out or switching accounts in Codex leaves this pool available.

The second account's verification request returned `429 usage_limit_reached`, so its inference quota must reset before it can contribute capacity. The original account passed the native Sol agent check. For another independent proxy login, run:

```bash
cli-proxy-login
```

The command prints an OpenAI device sign-in URL and a short code. Open the URL from any browser, enter the code, and choose the other ChatGPT account. Device login works remotely without a localhost callback or SSH tunnel. These separately authorized credentials belong to CLIProxyAPI and it refreshes them itself. Each independent account joins the pool. Account logins are kept by the proxy. The helper uses `-no-browser`, so it prints remote sign-in instructions without launching a browser on the host.

## Routing

Both instances route with `routing.strategy: fill-first`: a new conversation goes to the ready account with the highest `priority`. The runner sets those priorities so the account whose weekly window resets soonest is used first, and quota that would vanish at reset goes before quota with days left. Every minute `reset-order.ts` reads each instance's `GET /v0/management/auth-files` and takes each account's weekly quota signals: `X-Codex-Primary-Reset-At` and `X-Codex-Primary-Used-Percent` for Codex (or the secondary window when `X-Codex-Secondary-Window-Minutes` is `10080`), and `Anthropic-Ratelimit-Unified-7d-Reset`, `-7d-Utilization` (a 0–1 fraction) and `-7d-Status` (`rejected` counts as spent) for Claude. A reported five-hour primary Codex window is excluded. Claude and Codex accounts rank separately. It patches `priority` through `PATCH /v0/management/auth-files/fields` when an account's value changes:

- Accounts with quota left get `N` down to `1`, soonest reset highest, ties broken by auth index.
- Accounts with no current observation keep the default `0`. An observation whose reset time has passed counts as none.
- Spent accounts (100% used, reset still ahead) get `-1`, so a lapsed cooldown cannot put them ahead of usable quota.

Codex spends included weekly usage before [drawing from available credits](https://learn.chatgpt.com/docs/pricing). CLIProxyAPI records `X-Codex-Credits-Has-Credits`, `X-Codex-Credits-Balance` and `X-Codex-Active-Limit` as telemetry; a successful response at 100% weekly usage creates no cooldown. While an enabled Codex account has observed weekly quota left, the loop disables spent Codex accounts (100% used, reset still ahead) through `PATCH /v0/management/auth-files/status`. The next request on a bound session then fails over to usable weekly quota. This runs each minute after response observations arrive; an already-running request can finish before the next check.

The proxy keeps quota observations in memory only, so the runner stores the last one per account (keyed by auth index) in each instance's state file (`reset-order.json`, `claude/reset-order.json`) and uses it until the restarted proxy observes that account again. Each successful loop disable records `disabledByLoop: true` beside the observation. The loop re-enables only accounts it owns, when their weekly reset passes or no enabled Codex account has observed weekly quota left, making credits the last resort. Accounts disabled outside the loop are left alone. Unknown accounts do not establish remaining quota. An operator who wants to keep a loop-disabled account off should stop the loop and remove that account's ownership marker before leaving it disabled.

A Claude account has no observation until it serves a request. The priorities and disabled status persist in the auth files. Provider 429 responses still invoke the proxy's own cooldowns whatever the priority. Routing uses quota signals, independent of plan labels: an upgraded account can retain its old `id_token` label until a normal successful token refresh receives updated plan claims. The `resetOrder` blocks in `runtime.json` (`managementKeyFile`, `stateFile`, top level and under `claudeProxy`) turn this on; without them routing stays on the configured priorities. A failure series logs one `warn`, an `info` with the count on recovery, and after ten failed minutes a `gave-up` warning that stops the loop until the next start.

Session affinity retains an account within a conversation, and its bindings outrank priority; subagents can receive separate account bindings (`session-affinity-subagents: true`). A disabled or unavailable account can fail over to another account on the next request. Re-enabling an account leaves sessions that already failed over on their new bindings. Account limits and model access remain the provider's limits.

Anthropic documents custom model IDs but excludes non-Claude gateway models from official support. This integration is experimental. Custom `ANTHROPIC_BASE_URL` sessions also disable Claude Remote Control. GPT runs with Claude's agent harness; Codex-specific tooling and session recovery belong to Codex itself.

A live check on 2026-09-29 verified `claude-opus-5-5` invoking `Agent` with `subagent_type: sol`, the child responding as `gpt-6.1-sol`, executing `Bash` with `pwd`, and returning its result to Opus. This proves the native Agent path. The interactive subagent panel was not visually inspected. Claude emits an `unrecognized_model` diagnostic for GPT while the agent succeeds; its estimated costs and default context metadata for GPT may differ from Codex's catalog and subscription billing.

Before rebuilding and reloading, wait until no agents are mid-request. Rebuild after source changes with `bun build scripts/claude-gpt/run.ts --target bun --outfile /work/cli-proxy-api/gateway.js`, then `mesh serve stop /ai` so the next connection starts the update. Configuration and credentials remain outside Git.
