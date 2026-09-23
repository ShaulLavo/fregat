import { createStructuredError as createDesktopStructuredError } from '@workspace/observability/errors'
import { defineErrorCatalog } from 'evlog'

type PortHolder = { pid: number; name: string }

export const desktopErrors = defineErrorCatalog('desktop', {
  INTERNAL_ERROR: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'A desktop process invariant failed while starting or coordinating Platform.',
    fix: 'Inspect the desktop logs and fix the invariant at the throwing call site.',
  },
  PORT_IN_USE: {
    status: 409,
    message: ({ label, host, port, holders }: PortInUse) =>
      `The desktop ${label} port ${host}:${port} is in use by ${holderText(holders)}.`,
    why: 'The desktop starts its own server and web processes, and it only stops processes it started.',
    fix: 'Stop that process, or start the desktop with `bun run dev` in apps/desktop to reuse a running dev server.',
  },
  LEFTOVER_RUNNING: {
    status: 500,
    message: ({ names }: { names: readonly string[] }) =>
      `The desktop's ${names.join(' and ')} process from a previous launch did not stop.`,
    why: 'A process this desktop started earlier ignored SIGTERM and SIGKILL.',
    fix: 'Stop the leftover process by hand, then start the desktop again.',
  },
})

type PortInUse = { label: string; host: string; port: number; holders: readonly PortHolder[] }

function holderText(holders: readonly PortHolder[]) {
  if (holders.length === 0) return 'a process the desktop cannot inspect'
  return holders
    .map((holder) => (holder.name ? `${holder.name} (pid ${holder.pid})` : `pid ${holder.pid}`))
    .join(', ')
}

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
