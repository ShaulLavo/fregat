import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import * as v from 'valibot'
import path from 'node:path'
import { defineErrorCatalog } from 'evlog'
import {
  SERVER_IDENTITY_PROTOCOL_VERSION,
  machineServiceIntentSchema,
  machineServiceResultSchema,
  type MachineServiceIntent,
  type MachineServiceResult,
} from '@workspace/contracts'
import { readHomeSetting } from '../../../../scripts/home-setting'
import { ensureMachineService } from '../../../../scripts/service/ensure-machine-service'
import {
  installBundledRelease,
  rollbackBundledInstall,
} from '../../../../scripts/service/bundled-release'
import { machineReleaseRoot } from '../../../../scripts/service/release-root'

const installationErrors = defineErrorCatalog('desktop.installation', {
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'The Fregat machine service installer is unavailable.',
    why: 'The installed app needs the machine service setup included with its release.',
    fix: 'Install a Fregat release that includes machine service setup.',
  },
  IDENTITY_CONFLICT: {
    status: 409,
    message: 'The machine service identity differs from this installation.',
    why: 'The app registration must connect to its configured machine service and state.',
    fix: 'Check the machine service installation and configured server address.',
  },
})

export type EnsureMachineService = (
  intent: MachineServiceIntent,
  options: { productionRoot: string; signal?: AbortSignal },
) => Promise<MachineServiceResult>

export function installationReleaseRoot(stateHome: string, home: string) {
  return machineReleaseRoot(readHomeSetting(stateHome, 'server.releaseRoot'), {
    platform: process.platform,
    home,
    env: Bun.env,
  })
}

export function installationIntent(stateHome: string): MachineServiceIntent {
  const requested: MachineServiceIntent = {
    stateHome: canonicalStateHome(stateHome),
    address: readHomeSetting(stateHome, 'server.address'),
    webBase: readHomeSetting(stateHome, 'server.webBase'),
    expected: null,
  }
  let stored: unknown
  try {
    stored = JSON.parse(readFileSync(intentFile(stateHome), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return requested
    throw installationErrors.IDENTITY_CONFLICT({ internal: { stage: 'installation-intent' } })
  }
  const parsed = v.safeParse(machineServiceIntentSchema, stored)
  if (
    !parsed.success ||
    parsed.output.stateHome !== requested.stateHome ||
    parsed.output.address !== requested.address ||
    parsed.output.webBase !== requested.webBase
  )
    throw installationErrors.IDENTITY_CONFLICT({ internal: { stage: 'installation-target' } })
  return parsed.output
}

function intentFile(stateHome: string) {
  return path.join(stateHome, 'desktop', 'installation.json')
}

function rememberInstallation(intent: MachineServiceIntent, result: MachineServiceResult) {
  const file = intentFile(intent.stateHome)
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(
    temporary,
    JSON.stringify({
      ...intent,
      expected: {
        machineId: result.identity.machineId,
        environmentId: result.identity.environmentId,
      },
    }),
    { mode: 0o600 },
  )
  renameSync(temporary, file)
}

function canonicalStateHome(stateHome: string) {
  try {
    return realpathSync(stateHome)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return path.resolve(stateHome)
  }
}

export async function ensureInstalledService(options: {
  intent: MachineServiceIntent
  productionRoot: string | undefined
  signal: AbortSignal
  ensure?: EnsureMachineService
  bundledRelease?: string
}) {
  options.signal.throwIfAborted()
  if (!options.productionRoot)
    throw installationErrors.SERVICE_UNAVAILABLE({ internal: { stage: 'release-root' } })
  const installed = options.bundledRelease
    ? installBundledRelease(options.bundledRelease, options.productionRoot, options.intent)
    : null
  let result: MachineServiceResult
  try {
    result = await verifiedService(
      { intent: options.intent, productionRoot: options.productionRoot, signal: options.signal },
      options.ensure ?? ensureMachineService,
    )
  } catch (error) {
    if (installed) rollbackBundledInstall(options.productionRoot, installed)
    throw error
  }
  rememberInstallation(options.intent, result)
  return { ...result, url: new URL(result.identity.webBase, result.identity.address).href }
}

async function verifiedService(
  options: { intent: MachineServiceIntent; productionRoot: string; signal: AbortSignal },
  ensure: EnsureMachineService,
) {
  const intent = options.intent
  const returned = await ensure(intent, {
    productionRoot: options.productionRoot,
    signal: options.signal,
  })
  const parsed = v.safeParse(machineServiceResultSchema, returned)
  if (!parsed.success)
    throw installationErrors.IDENTITY_CONFLICT({ internal: { stage: 'service-result' } })
  const result = parsed.output
  const { identity } = result
  const expected = options.intent.expected
  const matches = {
    product: identity.product === 'fregat',
    protocol: identity.protocolVersion === SERVER_IDENTITY_PROTOCOL_VERSION,
    state: identity.stateHome === options.intent.stateHome,
    address: identity.address === options.intent.address,
    base: identity.webBase === options.intent.webBase,
    machine: !expected || identity.machineId === expected.machineId,
    environment: !expected?.environmentId || identity.environmentId === expected.environmentId,
  }
  if (Object.values(matches).some((match) => !match))
    throw installationErrors.IDENTITY_CONFLICT({ internal: { matches } })
  return result
}
