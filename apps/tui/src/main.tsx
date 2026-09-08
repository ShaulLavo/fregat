import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { homedir } from 'node:os'
import path from 'node:path'
import { TUI_CLIENT_ORIGIN } from '@workspace/contracts'
import {
  flushObservability,
  initializeObservabilityRuntime,
  recordObservabilityError,
  recordObservabilityInfo,
} from '@workspace/observability'

import { createSettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import { writeFrame } from '@/host/frame'
import { runInteractive } from '@/host/interactive'
import { createRpcObservation } from '@/host/observation'
import { createSocket } from '@/host/socket'
import { readArguments, usage } from '@/host/utils/arguments'

async function main() {
  const options = readArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage)
    return
  }
  initializeObservabilityRuntime({
    source: 'tui',
    env: { ...process.env, OBSERVABILITY_CONSOLE: 'false' },
  })
  const instanceId = `tui-${crypto.randomUUID()}`
  const client = createEnvironmentClient({
    origin: options.origin,
    headers: () => ({ origin: TUI_CLIENT_ORIGIN, 'x-client-instance': instanceId }),
  })
  const session = createSettingsSession({
    origin: options.origin,
    client,
    storageDirectory: path.join(homedir(), '.platform', 'tui'),
    createSocket: (url) => createSocket(url, instanceId),
    createServiceSocket: (url) => createSocket(url, instanceId),
    observation: createRpcObservation(instanceId),
    record: (event) =>
      recordObservabilityInfo('tui.connection', { ...event, instanceId, source: 'tui' }),
  })
  try {
    if (!options.framePath) {
      await runInteractive(session, options.noColor)
      return
    }
    const ready = await writeFrame({
      session,
      path: options.framePath,
      width: options.width,
      height: options.height,
      noColor: options.noColor,
    })
    process.stdout.write(`Frame written to ${options.framePath}\n`)
    if (!ready) process.exitCode = 1
  } finally {
    session.dispose()
    await session.flush()
    await flushObservability()
  }
}

try {
  await main()
} catch (error) {
  const failure = connectionFailure(error)
  recordObservabilityError('tui.startup', {
    code: failure.code,
    message: failure.message,
    source: 'tui',
  })
  process.stderr.write(`${failure.message}\n${failure.fix}\n`)
  await flushObservability()
  process.exitCode = 1
}

// Bun's watcher stays alive after the renderer closes unless the entry point exits.
process.exit()
