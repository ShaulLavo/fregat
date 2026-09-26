# Plan 185: One shared dev server that starts on use and exits when idle

## Status and authorization

- Status: PROPOSED 2026-09-26. Owner decisions recorded. **Blocked on mesh T28** (`/work/projects/mesh/docs/tasks/T28-serve-on-demand.md`,
  mesh `05a5d02`). Owner direction: one dev server that every session uses, started when someone
  needs it and gone when nobody does, built as a mesh feature. This plan is the Platform side.
  It replaces the "a dev server is always running" rule in `AGENTS.md`, which is false today
  (nothing listened on 5173 or 3001 on 2026-09-26).
- Effort: S once T28 lands.

## Outcome

- Any session or browser that connects to `localhost:5173` or `:3001` gets the dev server, starting
  it if needed. Nobody runs `bun run dev` by hand, and a second copy can't start.
- When no connection has been open for the idle window, the server exits on its own. That also
  bounds the Vite/rolldown memory growth measured in Plan 132's research question 1.

## Design

Mesh owns the lifecycle; Platform registers one on-demand route and makes its dev scripts fit it:

```
localhost:5173 ─┐                      ┌─▶ 127.0.0.1:15173  Vite
localhost:3001 ─┴─▶ mesh daemon (T28) ─┴─▶ 127.0.0.1:13001  API     one mesh session: bun run dev:web
```

- The mesh daemon binds both public ports. The first connection starts `bun run dev:web` as a mesh
  session, holds connections until both internal ports accept, then proxies them.
- "In use" means an open connection. An open app tab holds Vite's HMR socket and the API socket,
  so it counts; a session that only edits files does not, and does not need the server.
- `mesh ls` shows the server as a labelled session, `mesh <ID>` attaches to its output, and
  `mesh serve ls` shows `stopped`, `starting`, `running (N conns)` or `failed`.
- The route is local-only (no `--at`) and named by its first listen port: `:5173` in `mesh serve ls`,
  addressed as `mesh serve start|stop :5173` and `mesh unserve :5173`. The command runs through the
  user's login shell (`$SHELL -lc`), so mise's bun is on PATH; `--cwd` defaults to where `mesh serve`
  runs. It is ready once 15173 and 13001 both accept on `127.0.0.1`.
- An idle keep-alive connection counts as open until the daemon's 2-minute idle timeout closes it,
  so the effective idle window after the last tab closes is up to 17 minutes.

## Work

1. **Ports.** `scripts/dev.ts` stops hunting for a free port when 5173 is taken, and binds the
   internal ports it's given on `127.0.0.1` (mesh probes IPv4 loopback; `localhost` resolving to
   `::1` alone would never read as ready). The server's allowed origins and the client's API URL use the
   _public_ ports; both are already computed from the chosen port (Plan 132 item 9), so they get
   the public one.
2. **Registration.** `bun run dev:serve` runs the one idempotent
   `mesh serve omarchy --run 'bun run dev:web' --cwd <checkout> --listen 5173=15173 --listen 3001=13001 --idle <window>`
   (local-only; `--run` cannot be combined with `--public`),
   with the dev state home and `.env`; `dev:unserve` runs `mesh unserve :5173`. The idle window is a machine-scope
   settings entry that `dev:serve` passes as `--idle`.
3. **Restart-on-change.** The API's `restart-on-change.ts` keeps restarting its child inside the
   session. A connection during that gap fails as it does today; the route stays up.
4. **Manual runs.** `bun run dev` while mesh holds 5173 fails with a structured error naming the
   route and `mesh serve stop :5173` as the fix, never a port hunt.
5. **Rule.** Rewrite the `AGENTS.md` line: "The dev server starts on first connection to 5173/3001
   and exits after the idle window; never start one by hand. `mesh serve ls` shows it, and
   `mesh ls` lists its session for the output; `mesh serve stop :5173` stops it now."

## Owner decisions (2026-09-26, all as recommended)

- **Q1: idle window.** Decided: 15 minutes, since it covers a lunch break without holding memory all day.
- **Q2: background tabs.** Decided: a tab is use, so a forgotten tab keeps the server alive. The
  client keeps its sockets when hidden, so HMR and live data never reconnect on focus.
- **Q3: the desktop app.** `apps/desktop` launches its own dev children under leases (Plan 132 D1).
  Decided: in dev it connects to the shared ports like any browser, and stops spawning them.

T28's own questions are decided in the mesh brief: the tailnet path also starts the route, and
there are no explicit holds.

## Verification

- From nothing: `curl localhost:5173` starts the session and returns the app; the first byte
  arrives after Vite's boot, with no refused connection.
- Two clients: close one, and the server stays. Close both, and after the idle window the session
  has exited while both ports still accept.
- `bun run dev` beside the route fails with the structured error.
- An API source edit restarts the API child; the web tab reconnects.
- `look` against 5173 after a cold start.
