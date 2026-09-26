# RUNTIME-02 protocol survey: Antigravity (`agy_acp_server`)

Upstream read at T3 Code `7a12aff4` (2026-09-25). Since the plan pin `7445aa73`, `AntigravityDriver.ts` changed 33
lines, `AntigravityAdapter.ts` 28, `antigravityAuthSupport.ts` 48, and two fixes landed after the pin: `cdb26fe6`
(Stop ends commands that outlived their turn) and `f3cb2a1f` (Windows unpack path length). Not installed here and
not downloaded; nothing below is measured against the binary. Archive sizes are from HTTP `HEAD`.

## Install

- There is no package-manager CLI. The agent is the ACP server Google publishes through the ACP registry
  (`agentclientprotocol/registry`, `antigravity-acp/agent.json`): a zip per platform from
  `dl.google.com/agy-extensions/releases/…`, run as `./agy_acp_server.par` (Linux adds `--uid=`) next to a
  `localharness_external` harness binary.
- Size: registry version `1.2.1` today; its linux-x64 zip is 333,590,110 bytes. Upstream pins `1.1.1`
  (`antigravityRelease.ts:1`): a 682 MB zip that unpacks to a 1.88 GB executable plus a 129 MB harness, with
  sha256 and sizes checked 2026-09-03 (`:20-83`).
- Upstream downloads, verifies, unzips and switches releases itself (`AntigravityInstallation.ts`, 962 lines:
  45-minute download timeout, free-space margin, a lease held while a process runs, `remove`). The settings
  `binaryPath` overrides it; otherwise it searches `PATH` and then its managed directory.
- The server is a PyInstaller one-file bundle. It unpacks about 1 GB into a temp directory on every launch, so
  upstream never spawns it for health checks: the status probe reads the version from disk and returns a
  synthetic `initialize` response (`Drivers/AntigravityDriver.ts:333-370`). Each session gets its own
  `run-*` temp directory, released with the session, and stale ones are swept when the driver starts
  (`:122-131,202-215`). `8c18b5bb` fixed health checks that filled the disk with `_MEI` folders.

## Transport and events

- ACP over stdio with `resumeMethod: "resume"` and `cancelBehavior: "wait-for-prompt"`: a cancel waits for the
  prompt response and the event drain before the next prompt (`acp/AntigravityAcpSupport.ts:57-80`).
- Chat sessions advertise `fs.readTextFile` and `fs.writeTextFile`, so the agent routes workspace reads and
  writes through the client, and each edit arrives as a `session/request_permission` carrying the new content
  (`acp/AntigravityAcpSupport.ts:43-50`; `Layers/AntigravityAdapter.ts:825`). Setup, probe and text-generation
  runs leave file-system access off.
- Session updates are normalized by `acp/AntigravityProtocol.ts` (380 lines) before the shared ACP mapping.
  Stdout is filtered for an auth-URL line before JSON-RPC parsing (`antigravityAuthSupport.ts:495-530`).

## Approvals and permissions

Runtime mode becomes an ACP session mode through `session/set_mode`: `full-access` → `yolo`,
`auto-accept-edits` → `auto_edit`, `approval-required` and `auto` → `default`
(`acp/AntigravityAcpSupport.ts:91-100`; `Layers/AntigravityAdapter.ts:850,1072`). Requests go through the same
ACP permission bridge as the other two.

## Sessions and resume

- `session/resume` with the stored session id (`Layers/AntigravityAdapter.ts:800`); the synthetic probe lists
  `sessionCapabilities { list, resume }`.
- Rollback refused; capabilities `{ sessionModelSwitch: "in-session", supportsConversationRollback: false }`
  (`Layers/AntigravityAdapter.ts:1272,1291-1296`). Steering drains a cancelled prompt first (`:304,1047`).
- Each instance owns a profile directory (its own `GEMINI_HOME`, user home and temp root); releases are shared
  across instances (`Drivers/AntigravityDriver.ts:79`; `antigravityAuthSupport.ts:434-461`, spawned with
  `extendEnv: false`).

## Models and auth

- Auth methods (`packages/contracts/src/settings.ts:756-761`): `oauth-personal` (Google account, default),
  `oauth-business` (Gemini Enterprise), `gemini-api-key`, `agent-platform` (Vertex AI, with project and location).
  Environment keys upstream clears or sets: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`,
  `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_CLOUD_QUOTA_PROJECT`, `GOOGLE_GENAI_USE_VERTEXAI`
  (`antigravityAuthSupport.ts:64-70`).
- Google sign-in is in-app: the server prints an `accounts.google.com/o/oauth2/v2/auth` URL on stdout, upstream
  validates origin, path and a redirect port of 1024 or higher (`antigravityAuthSupport.ts:464-499`), shows the
  URL, and a Node helper script receives the callback (`antigravityCallback.ts`; `Drivers/AntigravityDriver.ts:196`
  reports a missing Node runtime). Normal launches reject the browser flow; only the sign-in run accepts it.
- Models come from the `model` session config option (`acp/AntigravityAcpSupport.ts:102-108`).

## On our layer

The most bespoke of the four. It needs the shared ACP client plus: a managed install (or a required
`binaryPath`), per-session temp directories with a sweep, a probe that never spawns, the per-instance profile,
the in-app OAuth flow over our `signIn` / `signInAttempt` adapter members, client-side `fs/read_text_file` and
`fs/write_text_file` handlers whose writes become approvals, and the auth-method settings. The API key goes to
the secret store. Upstream's Antigravity-only files total about 4,700 lines without tests (`AntigravityAdapter.ts`
1301, `AntigravityInstallation.ts` 962, `antigravityAuthSupport.ts` 605, `AntigravityAuth.ts` 542,
`AntigravityDriver.ts` 499, `AntigravityProvider.ts` 398, `acp/Antigravity*.ts` 820, plus release and callback).
