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
