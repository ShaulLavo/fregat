/** Stop the Fregat server before importing: its settings coordinator is process-local. */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  providerInstanceIdSchema,
  settingsMutationRequestSchema,
} from '../packages/contracts/src/index'
import * as v from 'valibot'
import { defaultSecretsFilePath, defaultSettingsFilePath } from '../apps/server/src/settings/paths'
import { PROXY_USAGE_MANAGEMENT_KEY_REF } from '../apps/server/src/settings/secrets'
import { SettingsStore } from '../apps/server/src/settings/store'
import { createScriptError } from './structured-errors'

const usage =
  'Usage: bun run usage:import-proxy-key <key-file> --url <localhost-http-url> [--instance <codex-instance-id>…]'
const stopped =
  'Stop the Fregat server before running this command. PLATFORM_HOME selects its state home.'

function settingsStore() {
  return new SettingsStore({
    userFilePath: defaultSettingsFilePath(),
    secretsFilePath: defaultSecretsFilePath(),
    watch: false,
  })
}

function listInstances() {
  const store = settingsStore()
  try {
    const ids = store
      .snapshot()
      .values['providers.instances'].filter(
        (entry) => entry.driverKind === 'codex' && entry.enabled !== false,
      )
      .map((entry) => entry.providerInstanceId)
    process.stdout.write(`${JSON.stringify(ids)}\n`)
  } finally {
    store.close()
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      'list-instances': { type: 'boolean' },
      url: { type: 'string' },
      instance: { type: 'string', multiple: true },
    },
  })
  if (values.help) {
    process.stderr.write(
      `${usage}\n${stopped}\nUse --list-instances to print configured enabled Codex instance IDs. Instance mappings are optional.\nThe key file contains one plain management key. An existing different key is preserved.\n`,
    )
    return
  }
  if (values['list-instances']) {
    if (positionals.length || values.url || values.instance?.length)
      throw createScriptError('List configured instance IDs with --list-instances alone.', {
        internal: { positionalCount: positionals.length, hasImportOptions: true },
      })
    listInstances()
    return
  }
  if (positionals.length !== 1 || !values.url)
    throw createScriptError('A key file and localhost URL are required.', {
      internal: {
        positionalCount: positionals.length,
        hasUrl: Boolean(values.url),
        instanceCount: values.instance?.length ?? 0,
      },
    })

  const instances = (values.instance ?? []).map((id) => v.parse(providerInstanceIdSchema, id))
  if (new Set(instances).size !== instances.length)
    throw createScriptError('Select each Codex instance once.', {
      internal: { instanceCount: instances.length },
    })
  const request = v.parse(settingsMutationRequestSchema, {
    mutationId: randomUUID(),
    target: 'user',
    operations: [
      { kind: 'set', key: 'providers.proxyUsageUrl', value: values.url },
      { kind: 'set', key: 'providers.proxyUsageProviderInstanceIds', value: instances },
    ],
  })
  const store = settingsStore()
  let bytes: Buffer | undefined
  try {
    const configured = store.snapshot().values['providers.instances']
    const selected = instances.map((id) =>
      configured.find((entry) => entry.providerInstanceId === id),
    )
    if (selected.some((entry) => !entry || entry.driverKind !== 'codex' || entry.enabled === false))
      throw createScriptError('Select enabled Codex instances configured in this state home.', {
        internal: { instanceCount: instances.length },
      })

    bytes = await readFile(positionals[0]!)
    const key = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r?\n$/, '')
    if (!key || /[\s\p{Cc}\p{Cf}]/u.test(key))
      throw createScriptError('The key file must contain one plain management key.', {
        internal: { validPlainKey: false },
      })
    const stored = await store.ensureSecret(PROXY_USAGE_MANAGEMENT_KEY_REF, () => key)
    if (stored !== key)
      throw createScriptError('A different management key is already stored.', {
        internal: { existingKeyMatches: false },
      })
    await store.write(request)
  } finally {
    bytes?.fill(0)
    store.close()
  }
}

try {
  await main()
} catch {
  // Settings validation and filesystem exceptions can contain input; expose fixed guidance only.
  process.stderr.write(
    `Proxy usage key import failed. Check the key file, localhost URL, selected Codex instances, and existing management key.\n${usage}\n${stopped}\n`,
  )
  process.exitCode = 1
}
