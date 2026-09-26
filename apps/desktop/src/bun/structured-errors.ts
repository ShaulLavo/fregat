import { createStructuredError as createDesktopStructuredError } from '@workspace/observability/errors'
import { defineErrorCatalog } from 'evlog'

export const desktopErrors = defineErrorCatalog('desktop', {
  INTERNAL_ERROR: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'A desktop process invariant failed while starting or coordinating Platform.',
    fix: 'Inspect the desktop logs and fix the invariant at the throwing call site.',
  },
  DEV_SERVER_UNREACHABLE: {
    status: 503,
    message: ({ url }: { url: string }) => `The dev server at ${url} did not answer.`,
    why: 'The desktop opens the shared dev server, which mesh starts on the first connection.',
    fix: 'Run `bun run dev:serve` once to register it, or `bun run dev` to run a private copy. `mesh serve ls` shows why a registered route failed.',
  },
})

export function createDesktopError(message: string, cause?: unknown) {
  return createDesktopStructuredError({
    cause,
    code: desktopErrors.INTERNAL_ERROR.code,
    fix: desktopErrors.INTERNAL_ERROR.fix,
    message,
    status: desktopErrors.INTERNAL_ERROR.status,
    why: desktopErrors.INTERNAL_ERROR.why,
  })
}
