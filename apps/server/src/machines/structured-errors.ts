import type { ConnectionError } from '@workspace/contracts'
import { defineErrorCatalog } from 'evlog'
import * as v from 'valibot'
import { createStructuredError, isEvlogError } from '../observability/structured-errors'
import type { ServerInstallation } from '../installation/descriptor'
import type { UpdateChannel } from './update'

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
    why: 'SSH refused the connection, or the installed Platform server could not describe itself.',
    fix: 'Check that the primary server’s user can reach that machine over SSH, then connect again.',
  },
  SSH_NOT_INSTALLED: {
    status: 412,
    message: 'Platform server is not installed for this SSH user.',
    why: 'The probe found no platform-server on PATH or in ~/.local/bin.',
    fix: 'Run bun run server:install from a prepared Platform checkout on that machine, then connect again.',
  },
  SSH_LAUNCH: {
    status: 502,
    message: 'The remote server could not start.',
    why: 'The remote launcher could not reuse or start the configured server.',
    fix: 'Inspect logs/ssh-launch.log in the server’s working directory on that machine and verify its dependencies are installed, then Retry.',
  },
  SSH_PROTOCOL: {
    status: 409,
    message: ({ running, expected }: { running: number; expected: number }) =>
      `The remote server speaks protocol ${running}, and this Platform needs protocol ${expected}.`,
    why: 'The server on that machine was started from a different Platform version.',
    fix: 'Update the Platform checkout on that machine to this server’s version, run bun install there, then Retry.',
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
  SSH_AUTH_CANCELLED: {
    status: 409,
    message: 'SSH authentication was cancelled.',
    why: 'The SSH prompt was dismissed before the connection finished.',
    fix: 'Connect again to answer the SSH prompt.',
  },
  SSH_STOP: {
    status: 502,
    message: 'The remote server could not be stopped.',
    why: 'SSH could not remove the launcher record and stop its managed server.',
    fix: 'Reconnect the SSH host and disconnect again, or inspect its .platform-ssh-launch record.',
  },
  SSH_UPDATE_NOT_A_RELEASE: {
    status: 409,
    message: 'This Platform server has no release to install on another machine.',
    why: 'An update copies the running server’s own release with its runtime manifest, and this release was built before releases carried one.',
    fix: 'Deploy this server with bun run deploy --server, then press Update server again.',
  },
  SSH_UPDATE_BUILD: {
    status: 500,
    message: 'This working tree did not build.',
    why: 'A development server builds apps/server from its working tree before it installs it on another machine, and that build failed.',
    fix: 'Fix the error bun run --cwd apps/server build reports, then press Update server again.',
  },
  SSH_UPDATE_NO_BUN: {
    status: 412,
    message: 'Bun is not installed for this SSH user.',
    why: 'The server runs on Bun, and the probe found no bun on PATH or in ~/.bun/bin.',
    fix: 'Install Bun on that machine with curl -fsSL https://bun.sh/install | bash, then select Update server again.',
  },
  SSH_UPDATE_OLD_BUN: {
    status: 412,
    message: ({ found, required }: { found: string; required: string }) =>
      `Bun ${found} on that machine is older than ${required}, the version this server’s release needs.`,
    why: 'Releases are built and tested with this repository’s Bun version.',
    fix: 'Run bun upgrade on that machine, then select Update server again.',
  },
  SSH_UPDATE_TRANSFER: {
    status: 502,
    message: 'The server release could not be copied to that machine.',
    why: 'Streaming the release over SSH into ~/.platform/server/releases failed.',
    fix: 'Check the SSH connection and the free disk space on that machine, then select Update server again.',
  },
  SSH_UPDATE_IMMUTABLE: {
    status: 409,
    message: 'The active release cannot be replaced in place.',
    why: 'The release has different contents and a server may still load files from it.',
    fix: 'Build a new release, then select Update server again.',
  },
  SSH_UPDATE_IN_USE: {
    status: 409,
    message: 'The previous server release is still in use.',
    why: 'Another connection holds the running server, so activation was deferred.',
    fix: 'Disconnect the other connections to that machine, then select Update server again.',
  },
  SSH_UPDATE_INSTALL: {
    status: 502,
    message: 'The server release could not be installed on that machine.',
    why: 'Installing the release’s runtime packages or switching ~/.platform/server/current to it failed.',
    fix: 'Check that the machine can reach the npm registry and that ~/.platform is writable, then select Update server again.',
  },
})

/** The refusals and failures of an update; each carries what the remote reported in `internal`. */
export const updateErrors = {
  notARelease: machineErrors.SSH_UPDATE_NOT_A_RELEASE,
  build: machineErrors.SSH_UPDATE_BUILD,
  noBun: machineErrors.SSH_UPDATE_NO_BUN,
  oldBun: machineErrors.SSH_UPDATE_OLD_BUN,
  transfer: machineErrors.SSH_UPDATE_TRANSFER,
  install: machineErrors.SSH_UPDATE_INSTALL,
  inUse: machineErrors.SSH_UPDATE_IN_USE,
  immutable: machineErrors.SSH_UPDATE_IMMUTABLE,
}

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

export type SshCatalogStep = keyof typeof sshErrors
export type SshErrorStep = SshCatalogStep | 'protocol'

/** `fix` replaces the catalog's when the caller knows more, such as the launch log's path. */
export function createSshError(
  step: SshCatalogStep,
  detail?: string,
  cause?: unknown,
  fix?: string,
) {
  const definition = sshErrors[step]
  return createStructuredError({
    code: definition.code,
    status: definition.status,
    why: definition.why,
    fix: fix ?? definition.fix,
    message: detail ? `${definition.message} ${detail}` : definition.message,
    cause,
  })
}

export function createSshNotInstalledError(exitCode: number) {
  return machineErrors.SSH_NOT_INSTALLED({ internal: { exitCode } })
}

export function sshAuthCancelled(cancelledAt: number) {
  return machineConnectionError(
    machineErrors.SSH_AUTH_CANCELLED({ internal: { cancelledAt } }),
    'probe',
  )
}

export const sshProtocolCode = machineErrors.SSH_PROTOCOL.code

/**
 * What each end of the launch saw. `installed` is the protocol a fresh launch would speak;
 * it and `otherLeases` are null when the check ran on this side.
 */
export type ProtocolReport = {
  expected: number
  running: number
  installed: number | null
  installation: ServerInstallation['kind'] | null
  kind: 'managed' | 'external' | null
  otherLeases: number | null
  port: number | null
  directory: string | null
}

export function createSshProtocolError(report: ProtocolReport) {
  return machineErrors.SSH_PROTOCOL({
    running: report.running,
    expected: report.expected,
    fix: protocolFix(report),
    internal: {
      expected: report.expected,
      running: report.running,
      installed: report.installed,
      installation: report.installation,
      kind: report.kind,
      otherLeases: report.otherLeases,
    },
  })
}

function protocolFix(report: ProtocolReport) {
  // The installation is what a relaunch would start, so it decides which side is newer.
  if ((report.installed ?? report.running) > report.expected)
    return 'Update this Platform server to the version on that machine, then Retry.'
  if (report.kind === 'external' && report.port !== null)
    return externalFix(report.port, report.installation)
  const others = report.otherLeases ?? 0
  if (report.installed === report.expected && others > 0)
    return `Disconnect the ${others} other ${others === 1 ? 'connection' : 'connections'} to that machine’s server, then Retry.`
  if (report.installation === 'release')
    return 'Install this server’s release on that machine, then Retry.'
  if (report.installed === report.expected && report.directory)
    return `Run bun install in ${report.directory} so the server’s dependencies match that checkout, then Retry.`
  if (!report.directory) return machineErrors.SSH_PROTOCOL.fix
  return `Update the Platform checkout at ${report.directory} to this server’s version, run bun install there, then Retry.`
}

function externalFix(port: number, installation: ProtocolReport['installation']) {
  if (installation === 'release')
    return `Restart the Platform server on remote port ${port} from this server’s release, then Retry.`
  return `Restart the Platform server on remote port ${port} from a checkout at this server’s version, then Retry.`
}

const updateFixes = {
  prod: {
    install: 'Select Install server to put this server’s release on that machine.',
    update: 'Select Update server to install this server’s release on that machine and reconnect.',
  },
  dev: {
    install: 'Select Install server to build this working tree and put it on that machine.',
    update:
      'Select Update server to build this working tree, install it on that machine and reconnect.',
  },
}

/**
 * The fix that names the update button, when this server can ship a release and installing it
 * would clear `error`: never for an external server, a newer remote or one other leases hold.
 */
export function releaseUpdateFix(
  code: string,
  internal: Record<string, unknown> | undefined,
  channel: UpdateChannel,
) {
  const fixes = updateFixes[channel]
  if (code === machineErrors.SSH_NOT_INSTALLED.code) return fixes.install
  if (code !== sshProtocolCode) return null
  const report = v.safeParse(protocolInternalSchema, internal)
  if (!report.success) return null
  const { expected, running, installed, kind, otherLeases } = report.output
  if (kind === 'external' || (otherLeases ?? 0) > 0) return null
  if ((installed ?? running) > expected) return null
  return fixes.update
}

const protocolInternalSchema = v.object({
  expected: v.number(),
  running: v.number(),
  installed: v.nullable(v.number()),
  kind: v.nullable(v.picklist(['managed', 'external'])),
  otherLeases: v.nullable(v.number()),
})

/** The failure a machine state carries: a catalog error keeps its code, anything else becomes the step's entry. */
export function machineConnectionError(error: unknown, step: SshCatalogStep): ConnectionError {
  const failure =
    isEvlogError(error) && error.code
      ? error
      : createSshError(step, error instanceof Error ? error.message : undefined)
  return {
    code: failure.code ?? sshErrors[step].code,
    message: failure.message,
    why: failure.why,
    fix: failure.fix,
  }
}
