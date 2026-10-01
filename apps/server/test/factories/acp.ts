import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { providerInstanceIdSchema, sessionIdSchema, turnIdSchema } from '@workspace/contracts'
import type { AnyProviderDriver } from '../../src/provider/driver'
import { resolveProviderInstanceEnvironment } from '../../src/provider/utils/instance-environment'
import type { ProviderTurnInput } from '../../src/provider/types'

export async function createAcpFixture(
  driver: AnyProviderDriver,
  options: { config?: unknown; environment?: NodeJS.ProcessEnv } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), `fregat-acp-${driver.driverKind}-`))
  const binaryPath = path.join(root, `${driver.driverKind}-fixture.mjs`)
  const source = await readFile(
    path.resolve(import.meta.dirname, '../../../../scripts/agent/fixtures/fake-acp.mjs'),
    'utf8',
  )
  await writeFile(binaryPath, source.replace(/^#!.*$/m, `#!${process.execPath}`))
  await chmod(binaryPath, 0o755)
  const log = path.join(root, 'rpc.jsonl')
  const providerInstanceId = v.parse(providerInstanceIdSchema, `${driver.driverKind}-fixture`)
  const config = driver.parseConfig(options.config ?? { configHome: path.join(root, 'profile') })
  const env = resolveProviderInstanceEnvironment({
    base: { PATH: process.env.PATH, HOME: root, FREGAT_ACP_FIXTURE_LOG: log },
    derived: driver.environment(config, providerInstanceId),
    overrides: Object.entries(options.environment ?? {}).flatMap(([name, value]) =>
      value === undefined ? [] : [{ name, value }],
    ),
  })
  const handle = await driver.create({
    binaryPath,
    config,
    displayLabel: `${driver.displayName} fixture`,
    enabled: true,
    env,
    providerInstanceId,
    services: { cwd: root, acpOperationTimeoutMs: () => 5000 },
  })
  const input: ProviderTurnInput = {
    attachments: [],
    cwd: root,
    interactionMode: 'default',
    messageText: 'hello',
    modelSelection: { providerInstanceId, model: 'auto' },
    providerInstanceId,
    runtimeEpoch: 'fixture-epoch',
    runtimeMode: 'approval-required',
    sessionId: v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cde'),
    turnId: v.parse(turnIdSchema, `${driver.driverKind}-turn`),
  }
  return {
    root,
    binaryPath,
    handle,
    input,
    env,
    config,
    records: async (): Promise<Array<Record<string, any>>> => {
      try {
        return (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      } catch {
        return []
      }
    },
    dispose: async () => {
      await handle.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
