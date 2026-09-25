import { defineErrorCatalog } from 'evlog'
import { createStructuredError } from '../observability/structured-errors'

const machineErrors = defineErrorCatalog('machines', {
  SSH_DISCOVERY: {
    status: 500,
    message: 'SSH hosts could not be listed.',
    why: 'An SSH configuration file could not be read or parsed.',
    fix: 'Check the primary server user’s SSH configuration and included files, or enter the SSH address manually.',
  },
  SSH_SETTINGS: {
    status: 400,
    message: 'The SSH machine configuration is invalid.',
    why: 'The backend launcher could not resolve a valid SSH entry from the primary settings.',
    fix: 'Open Settings → Machines on the local machine and correct the entry.',
  },
  SSH_PROBE: {
    status: 502,
    message: 'The SSH machine could not be reached.',
    why: 'SSH refused the connection, or the Platform server installation was unavailable.',
    fix: 'Check the SSH connection. Install the server for that SSH user with bun run server:install from a prepared Platform checkout.',
  },
  SSH_LAUNCH: {
    status: 502,
    message: 'The remote server could not start.',
    why: 'The remote launcher could not reuse or start the configured server.',
    fix: 'Inspect logs/ssh-launch.log in the remote checkout and verify its dependencies are installed.',
  },
  SSH_FORWARD: {
    status: 502,
    message: 'The SSH port forward is unavailable.',
    why: 'SSH exited or the retained local forwarding port is occupied.',
    fix: 'Restore the SSH connection and free the reported local port, then reconnect the machine.',
  },
  SSH_READINESS: {
    status: 504,
    message: 'The forwarded server did not become ready.',
    why: 'The forwarded /health endpoint did not answer with a valid descriptor.',
    fix: 'Inspect the remote server log and verify SERVER_ALLOWED_ORIGINS includes the browser origin.',
  },
  SSH_IDENTITY: {
    status: 409,
    message: 'The SSH machine identity changed.',
    why: 'The forwarded server identity differs from the previously confirmed environment.',
    fix: 'Restore the machine’s original database before reconnecting.',
  },
  SSH_STOP: {
    status: 502,
    message: 'The remote server could not be stopped.',
    why: 'SSH could not remove the launcher record and stop its managed server.',
    fix: 'Reconnect the SSH host and disconnect again, or inspect its .platform-ssh-launch record.',
  },
})

export type SshErrorStep =
  | 'discovery'
  | 'settings'
  | 'probe'
  | 'launch'
  | 'forward'
  | 'readiness'
  | 'identity'
  | 'stop'

const sshErrors = {
  discovery: machineErrors.SSH_DISCOVERY,
  settings: machineErrors.SSH_SETTINGS,
  probe: machineErrors.SSH_PROBE,
  launch: machineErrors.SSH_LAUNCH,
  forward: machineErrors.SSH_FORWARD,
  readiness: machineErrors.SSH_READINESS,
  identity: machineErrors.SSH_IDENTITY,
  stop: machineErrors.SSH_STOP,
}

export function createSshError(step: SshErrorStep, detail?: string, cause?: unknown) {
  const definition = sshErrors[step]
  return createStructuredError({
    code: definition.code,
    status: definition.status,
    why: definition.why,
    fix: definition.fix,
    message: detail ? `${definition.message} ${detail}` : definition.message,
    cause,
  })
}
