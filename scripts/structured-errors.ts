import { createError, defineErrorCatalog, EvlogError } from 'evlog'
import { errorMessage } from '../packages/contracts/src/error-fields'

export const scriptErrors = defineErrorCatalog('scripts', {
  INVALID_INPUT: {
    status: 400,
    message: ({ message }: { message: string }) => message,
    why: 'A local Platform script received invalid input or missing prerequisites.',
    fix: 'Adjust the script arguments or environment and run the command again.',
  },
  DEV_ROUTE_HOLDS_PORT: {
    status: 409,
    message: ({ port, route }: { port: number; route: string }) =>
      `Port ${port} belongs to the shared dev server route ${route}.`,
    why: 'Mesh serves the dev server on this port and starts it on the first connection.',
    fix: 'Open the app on this port; it starts the shared server. `mesh serve stop :5173` restarts it on the next connection, and `bun run dev:unserve` frees the ports for a private `bun run dev`.',
  },
  DEV_PORT_IN_USE: {
    status: 409,
    message: ({ port, holders }: { port: number; holders: string }) =>
      `Port ${port} is in use by ${holders}.`,
    why: 'The dev server binds fixed ports so the server origin allowlist and mesh route stay exact.',
    fix: 'Stop that process, then run the command again. Most sessions want the shared dev server: `bun run dev:serve` registers it once.',
  },
  MESH_FAILED: {
    status: 502,
    message: ({ command, exitCode }: { command: string; exitCode: number }) =>
      `\`mesh ${command}\` exited with ${exitCode}.`,
    why: 'The shared dev server is a mesh route, and mesh refused or failed the change.',
    fix: 'Read the mesh output above; `mesh serve ls` shows the routes and `mesh version` must be v0.1.52 or later.',
  },
  NOTHING_STAGED: {
    status: 409,
    message: 'No release is staged to restart into.',
    why: '`--restart` promotes the release `deploy --server` staged, and there is none.',
    fix: 'Run `bun run deploy --server --restart` to build, stage and restart in one step.',
  },
  RESTART_BUSY: {
    status: 409,
    message: ({ count, minutes }: { count: number; minutes: number }) =>
      `${count} session${count === 1 ? '' : 's'} stayed busy for ${minutes} minutes, so the server kept running.`,
    why: 'A restart ends running turns, so `--restart` waits for them to finish, as the Restart button does.',
    fix: 'Run `bun run deploy --restart` again later, or add `--interrupt` to end those turns now. Inside a Platform chat your own turn counts as busy, so use `--interrupt` there.',
  },
  RESTART_REQUEST_FAILED: {
    status: 502,
    message: ({ detail }: { detail: string }) => `The restart request failed: ${detail}`,
    why: '`--restart` sends the Restart button’s request to the production server on loopback.',
    fix: 'Check that the server runs (`systemctl --user status platform-prod`) and read `journalctl --user -u platform-prod -n 50`.',
  },
})

export function createScriptError(message: string) {
  return createError({
    code: scriptErrors.INVALID_INPUT.code,
    fix: scriptErrors.INVALID_INPUT.fix,
    message,
    status: scriptErrors.INVALID_INPUT.status,
    why: scriptErrors.INVALID_INPUT.why,
  })
}

/** A script's last words: the message, then why and fix when the error carries them. */
export function scriptFailureText(error: unknown) {
  if (!(error instanceof EvlogError)) return errorMessage(error)
  return [error.message, error.why && `Why: ${error.why}`, error.fix && `Fix: ${error.fix}`]
    .filter(Boolean)
    .join('\n')
}
