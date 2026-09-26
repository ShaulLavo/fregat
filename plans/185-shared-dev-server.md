# Plan 185: One shared dev server that starts on use and exits when idle

## Status and authorization

- Status: PROPOSED 2026-09-26. Owner direction: one dev server that every session uses, started
  when someone needs it and gone when nobody does. Replaces the "a dev server is always running"
  rule in `AGENTS.md`, which is false today (nothing listened on 5173 or 3001 on 2026-09-26).
- Effort: S–M. Everything used ships with systemd; no new dependency.

## Outcome

- Any session or browser that connects to `localhost:5173` or `:3001` gets the dev server, starting
  it if needed. Nobody runs `bun run dev` by hand, and a second copy can't start.
- When no connection has been open for the idle window, the server exits on its own. That also
  bounds the Vite/rolldown memory growth measured in Plan 132's research question 1.

## Design

systemd socket activation, with `systemd-socket-proxyd --exit-idle-time` as the use counter:

```
platform-dev-web.socket  127.0.0.1:5173 ─▶ platform-dev-web-proxy.service ─▶ 127.0.0.1:15173 ┐
platform-dev-api.socket  127.0.0.1:3001 ─▶ platform-dev-api-proxy.service ─▶ 127.0.0.1:13001 ├▶ platform-dev.service (bun run dev:web)
```

- systemd holds both public ports. The first connection starts the proxy, which `Requires=` and
  starts after `platform-dev.service`.
- The dev service is "started" only once its `ExecStartPost` sees both internal ports accept, so the
  first request waits for Vite's boot and never gets a refused connection.
- Each proxy exits after `--exit-idle-time` with no open connection. The dev service has
  `StopWhenUnneeded=yes`, so it stops when both proxies have exited. The sockets stay listening,
  ready for the next use.
- "In use" means an open TCP connection. An open app tab holds Vite's HMR socket and the API
  socket, so it counts; a session that only edits files does not, and does not need the server.
- The units are rendered by a script, like `scripts/deploy/mesh.ts` renders `platform-prod.service`
  (`bun run dev:install` writes and enables them; `dev:uninstall` removes them). The idle window is
  a settings-registry entry (machine scope) that the renderer reads, not an env var.

## Work

1. **Ports.** `scripts/dev.ts` stops hunting for a free port when 5173 is taken, and binds the
   internal ports it's given. The server's allowed origins and the client's API URL use the
   _public_ ports; both are already computed from the chosen port (Plan 132 item 9), so they get
   the public one.
2. **Units.** Render the two sockets, the two proxies and the dev service, with bun from the mise
   install path, the dev state home `/work/platform-dev/home`, `.env`, and a readiness
   `ExecStartPost`. Logs go to the journal plus the usual `logs/` JSONL.
3. **Restart-on-change.** The API's `restart-on-change.ts` keeps restarting its child inside the
   service. A connection during that gap fails as it does today; the proxies stay up.
4. **Manual runs.** `bun run dev` while the socket owns 5173 fails with a structured error naming the
   unit and `systemctl --user stop platform-dev-web.socket` as the fix, never a port hunt.
5. **Rule.** Rewrite the `AGENTS.md` line: "The dev server starts on first connection to 5173/3001
   and exits after the idle window; never start one by hand. `systemctl --user status platform-dev`
   shows it; `journalctl --user -u platform-dev` has its output."

## Open questions for the owner

- **Q1: idle window.** Recommend 15 minutes: it covers a lunch break without holding memory all day.
- **Q2: background tabs.** A forgotten tab keeps the server alive indefinitely. Recommend accepting
  that (a tab is use) over having the client drop its sockets when hidden, which would make HMR and
  live data reconnect on every focus.
- **Q3: the desktop app.** `apps/desktop` launches its own dev children under leases (Plan 132 D1).
  Recommend it connects to the shared ports in dev, like any browser, and stops spawning them.

## Verification

- From nothing: `curl localhost:5173` starts all three services and returns the app; the first byte
  arrives after Vite's boot, with no refused connection.
- Two clients: close one, and the server stays. Close both, and after the idle window
  `systemctl --user is-active platform-dev` reports `inactive` while both sockets are `listening`.
- `bun run dev` beside the socket fails with the structured error.
- An API source edit restarts the API child; the web tab reconnects.
- `look` against 5173 after a cold start.
