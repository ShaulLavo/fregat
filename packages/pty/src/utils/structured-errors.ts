import { defineErrorCatalog } from 'evlog'

export const ptyErrors = defineErrorCatalog('pty', {
  UNSUPPORTED_RUNTIME: {
    status: 500,
    message: 'Bun native PTY support is unavailable.',
    why: 'This package requires Bun.Terminal on Linux or macOS; older runtimes can crash on failed spawns.',
    fix: 'Run with Bun 1.3.14 or later on a supported operating system.',
  },
  INVALID_OPTIONS: {
    status: 400,
    message: ({ message }: { message: string }) => message,
    why: 'The supplied command or terminal dimensions are invalid.',
    fix: 'Supply a nonempty command without NUL bytes and integer dimensions from 1 to 65535.',
  },
  SPAWN_FAILED: {
    status: 500,
    message: 'Could not spawn the terminal process.',
    why: 'The operating system could not start the command in the requested directory.',
    fix: 'Check the executable, working directory, permissions, and available file descriptors.',
  },
  OPERATION_FAILED: {
    status: 500,
    message: ({ operation }: { operation: string }) => `PTY ${operation} failed.`,
    why: 'The terminal operation or output consumer failed.',
    fix: 'Inspect the error cause and close the PTY before starting another session.',
  },
})

export function operationError(operation: string, cause: unknown) {
  return ptyErrors.OPERATION_FAILED({ operation, ...causeOptions(cause) })
}

function causeOptions(cause: unknown) {
  if (cause === undefined) return {}
  if (cause instanceof Error) return { cause }

  return { internal: { cause } }
}
