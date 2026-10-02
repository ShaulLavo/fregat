# Claude Code with GPT subagents

The `claude-gpt` launcher points one Claude Code session at a local Messages gateway. Claude requests go directly to Anthropic using the caller's own Claude login. GPT models go through CLIProxyAPI's Messages-to-Codex translation. The `sol` agent uses the real `gpt-6.1-sol` model ID and Claude Code's agent tool loop.

The installation on this machine lives at `/work/cli-proxy-api`. Mesh starts the gateway runner on demand and stops it after its configured idle window. The runner owns the Codex proxy child, so stopping or restarting `/ai` also stops or respawns that child. The launcher leaves the normal `claude` command and shared agent instructions unchanged.

## Claude safety boundary

The current configuration has one Claude Max profile, `shaul9191`, using the owner's own login. Runtime JSON must contain `"claudePoolEntrypoints": []` and omit `claudeProxy`. Keep Claude credentials out of CLIProxyAPI. Claude account pooling caused an account ban; there are no Claude proxy logins to configure or refresh.

The gateway retains historical pool support in source, outside the passive producer's scope. Enabling `usageFeed` validates the empty-entrypoint/no-Claude-proxy boundary at startup. A configured feed profile supplies an approved display identity; it never changes requests, routing or credentials.

## Addresses and lifecycle

Runtime JSON is authoritative for ports. The current Mesh `/ai` frontend is `8318`, the loopback gateway backend is `18318`, and the owned Codex proxy is `18317`. The gateway binds loopback only. Management stays on loopback and the existing key file stays private to the gateway host.

Mesh preserves incoming Host. The gateway accepts loopback Host values, rejects browser Origin and Sec-Fetch-Site headers, and requires the caller's Claude authentication on Messages requests. Same-user local processes remain trusted because they can read the installation's key files.

The runner starts the gateway while the Codex registry loads. Direct Claude requests do not wait for the registry. `/health` checks the authenticated GPT model registry; passive usage sampling never calls `/health`, the model registry or any activation route. GPT requests retain their existing bounded registry recovery and one-replay behavior.

The gateway forwards original JSON request bytes and end-to-end headers on the direct Claude path. Responses and SSE bodies pass through the existing relay, which strips hop-by-hop and decompression-related headers. Request cancellation reaches upstream fetch. Quiet SSE streams retain the disabled gateway idle timeout and the 32 MiB request-body cap.

## Passive AI plans feed

[Plan 289](../../plans/289-proxy-usage-feed.md) owns the producer and Mesh TV consumer contract. This producer runs only within the already-running gateway lifecycle:

- Codex: one serialized, bounded `GET /v0/management/auth-files` at intervals of at least 60 seconds, using the existing management key. This reads cached quota/model/cooldown observations. It sends zero provider requests.
- Claude: capture understood `Anthropic-Ratelimit-Unified-*` response headers only on ordinary direct Anthropic requests. The observer reads no body and leaves headers, streams, status, errors and abort behavior unchanged.
- Publish sanitized generic JSON v1 to `v1.json` with same-directory atomic replacement. The whole response and output file are each bounded to 64 KiB. Observation ages and relative resets come from upstream observation timestamps. Inspection/publication times cannot freshen quotas.
- The understood websocket Spark namespace and HTTP Bengalfox namespace share one additional allowance identity. Aggregate windows remain separate; window identity comes from known quota namespaces.
- Retain previous valid windows through cache failures, missing signals and gateway restart. Independently aged windows stay independent. Passed resets retain historical readings until ordinary traffic supplies new observations.
- Include the registered Claude Max and both Codex Pro identities before traffic, as `no-data`. Proxy availability describes schedulability; it supplies no last-serving attribution. `lastServedAt` remains null.
- The feed directory contains only the sanitized snapshot and a transient sanitized atomic-write file. Credentials, raw header names/values, complete emails, paths, request bodies and upstream error text never enter the feed.

Enable through the existing runtime JSON mechanism. These tool-owned options do not enter Fregat's application settings registry. Example addition, retaining existing binary/proxy/port/key/reset-order configuration:

```json
{
  "claudePoolEntrypoints": [],
  "usageFeed": {
    "directory": "/work/cli-proxy-api/usage-feed",
    "managementKeyFile": "/work/cli-proxy-api/management-key",
    "intervalMs": 60000,
    "requestTimeoutMs": 5000,
    "accounts": [
      { "id": "claude-shaul9191", "provider": "claude", "label": "shaul9191", "plan": "max" },
      { "id": "codex-shaul9191", "provider": "codex", "label": "shaul9191", "plan": "pro" },
      {
        "id": "codex-shaul.lavochkin",
        "provider": "codex",
        "label": "shaul.lavochkin",
        "plan": "pro"
      }
    ]
  }
}
```

`managementKeyFile` is required when the feed is enabled. Defaults are the three approved accounts above, `60000` ms cadence, `5000` ms deadline, and a dedicated `~/.claude-gpt/usage-feed` directory. Choose an explicit isolated directory for deployment. Account IDs, short labels and plans are validated safe display values. Exactly one Claude account is supported; full emails are used only transiently to match approved Codex local-part labels. No auth-directory fallback exists.

The publication root must be a real directory. The producer resolves physical ancestor paths and management-key targets before reading or publishing a snapshot, including dangling aliases into future feed files. Key targets inside the feed are rejected before any publication or fetch. Safe temporary-directory ancestor aliases remain supported; a temporarily missing key preserves previous data while sampling fails.

`resetOrder` remains a separate Codex routing policy. It reads cached weekly quota and can patch account priority/disabled status. The passive producer neither invokes its actions nor changes that policy. Existing Codex OAuth refresh and session affinity remain owned by CLIProxyAPI.

## Coordinator deployment procedure

These steps are deferred live operations, separate from source verification. They interrupt agents; schedule them with the coordinator. Do not print runtime JSON, management keys or auth records.

1. Resolve the registered `/ai` runner command and its runtime JSON path using `mesh serve ls`. Inspect only projected port values and the no-pool guard; the current listener is runtime-configured `18318`, not the source/default frontend port. Before enabling the feed, ensure `claudePoolEntrypoints` is explicitly empty and `claudeProxy` is absent.
2. Add the `usageFeed` block above to that existing runtime JSON; preserve its other fields. Keep the feed in its own directory. No Claude proxy/logins, management enablement, proxy configuration change or separate proxy restart is needed.
3. From the merged Fregat checkout, build a staging bundle through the heavy wrapper and copy it into the installed gateway path:

   ```bash
   mkdir -p /work/tmp/usage-producer-build
   bun /work/platform-production/heavy/current/run.js --class build usage-producer-build -- \
     bun build scripts/claude-gpt/run.ts --target bun --outfile /work/tmp/usage-producer-build/gateway.js
   install -m 0644 /work/tmp/usage-producer-build/gateway.js /work/cli-proxy-api/gateway.js
   ```

4. At the scheduled interruption, wait until no agents are mid-request, then run `mesh serve stop /ai`. The next ordinary `/ai` connection loads the new gateway bundle and **respawns its owned Codex proxy**. Do not send a provider probe to start it. Initial publication happens on runner startup; feed reads never start the runner.
5. Once the sanitized directory exists, register a separate tailnet-only static route:

   ```bash
   mesh serve omarchy /work/cli-proxy-api/usage-feed --at /ai-usage --isolate
   ```

   The dedicated sanitized directory and tailnet-only route are the security boundary. `--isolate` adds cross-origin isolation headers and is optional. Use no `--files`, `--run`, `--listen`, `--public`, `--wake-on-request` or credential override. The consumer URL is `https://omarchy.mesh.shaulavo.dev/ai-usage/v1.json`.

6. The coordinator verifies route isolation, no redirects into activation/provider/management routes, continued snapshot reads while `/ai` sleeps, unchanged inference idle time, and the final Pi display. Those checks and Mesh consumer configuration/release are outside portable producer fixtures.

## Focused verification

```bash
bun /work/platform-production/heavy/current/run.js --class light usage-producer-tests -- \
  bun --bun vitest run scripts/claude-gpt/usage-feed.test.ts \
    scripts/claude-gpt/usage-producer.test.ts scripts/claude-gpt/usage-gateway.test.ts --environment node
```

The tests use injected HTTP fetchers, synthetic signals and OS-temporary files. They require no provider account, installed proxy, Mesh, Pi or owner filesystem. Root `test:scripts` includes all three files so CI runs them.
