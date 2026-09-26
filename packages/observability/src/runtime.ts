import { existsSync } from 'node:fs'
import path from 'node:path'

import { definePlugin, initLogger, log, type DrainContext } from 'evlog'
import { createFsDrain } from 'evlog/fs'
import { createDrainPipeline, type PipelineDrainFn } from 'evlog/pipeline'
import { createPostHogDrain } from 'evlog/posthog'

import {
  observabilityConfigFromEnv,
  type ObservabilityConfig,
  type ObservabilityEnv,
} from './config'
import { createLogRetention } from './retention'

export type ObservabilityDrain = PipelineDrainFn<DrainContext>

export type ObservabilityRuntime = {
  config: ObservabilityConfig
  drain: ObservabilityDrain | null
}

export type InitializeObservabilityOptions = {
  /** Which build is running. Stamped on every line so deploy skew is visible. */
  build?: { commit?: string | null; release?: string | null }
  env?: ObservabilityEnv
  shouldPersistEvent?: ShouldPersistObservabilityEvent
  source: string
}

export type ShouldPersistObservabilityEvent = (context: DrainContext) => boolean

type DrainAdapter = {
  drain: ObservabilityDrain
}

const disabledConfig = observabilityConfigFromEnv({
  OBSERVABILITY_ENABLED: 'false',
  NODE_ENV: 'test',
})

let runtime: ObservabilityRuntime = {
  config: disabledConfig,
  drain: null,
}

// The server's `logs.retentionDays`; the settings store starts after the logger.
let readLogRetentionDays: () => number = () => 0

/** How many UTC days of log files the file writer keeps; read at each day's first write. */
export function setLogRetentionDays(read: () => number) {
  readLogRetentionDays = read
}

export function initializeObservabilityRuntime(options: InitializeObservabilityOptions) {
  const rawConfig = observabilityConfigFromEnv(options.env ?? process.env)
  const config = { ...rawConfig, logDir: resolveLogDir(rawConfig.logDir) }
  const shouldPersistEvent = options.shouldPersistEvent ?? persistEveryEvent
  const drain = config.enabled ? createObservabilityDrain(config, shouldPersistEvent) : null

  initLogger({
    enabled: config.enabled,
    env: {
      environment: config.environment,
      service: config.service,
      ...(options.build?.commit ? { commitHash: options.build.commit } : {}),
      ...(options.build?.release ? { version: options.build.release } : {}),
    },
    ...(drain ? { drain } : {}),
    pretty: config.consoleEnabled && config.environment !== 'production',
    redact: true,
    sampling: {
      keep: [{ status: 400 }, { duration: config.slowMs }],
      rates: {
        debug: config.debugSampleRate,
        error: 100,
        info: config.infoSampleRate,
        warn: 100,
      },
    },
    // `silent` only suppresses an enabled logger. Passing it alongside
    // `enabled: false` makes older evlog versions warn that no drain exists.
    silent: config.enabled && !config.consoleEnabled,
    stringify: true,
    plugins: [sourcePlugin(options.source)],
  })

  runtime = { config, drain }
  return runtime
}

export function isObservabilityActive() {
  return runtime.config.enabled
}

export function observabilityConfig() {
  return runtime.config
}

export async function flushObservability() {
  await runtime.drain?.flush()
}

export async function resetObservabilityForTests() {
  await flushObservability()
  initLogger({
    enabled: false,
    env: {
      environment: 'test',
      service: 'platform',
    },
    silent: false,
  })
  runtime = { config: disabledConfig, drain: null }
}

export function recordObservabilityInfo(action: string, context: Record<string, unknown> = {}) {
  if (!runtime.config.enabled) return

  log.info({ action, ...context })
}

export function recordObservabilityWarning(action: string, context: Record<string, unknown> = {}) {
  if (!runtime.config.enabled) return

  log.warn({ action, ...context })
}

export function recordObservabilityError(action: string, context: Record<string, unknown> = {}) {
  if (!runtime.config.enabled) return

  log.error({ action, ...context })
}

function createObservabilityDrain(
  config: ObservabilityConfig,
  shouldPersistEvent: ShouldPersistObservabilityEvent,
) {
  const adapters = [createFileDrainAdapter(config), createPostHogDrainAdapter(config)].filter(
    isDrainAdapter,
  )

  return combineDrainAdapters(adapters, shouldPersistEvent)
}

function createFileDrainAdapter(config: ObservabilityConfig): DrainAdapter {
  const fsDrain = createFsDrain({
    dir: config.logDir,
    maxFiles: config.maxFiles,
    maxSizePerFile: config.maxSizePerFile,
    pretty: config.filePretty,
  })
  const pipeline = createAdapterPipeline('file', config)
  const retention = createLogRetention(config.logDir, () => readLogRetentionDays())

  return {
    drain: pipeline(async (batch) => {
      if (!batch.length) return

      await fsDrain(batch)
      const pruned = await retention()
      if (pruned > 0) log.info({ action: 'observability.logs_pruned', fileCount: pruned })
    }),
  }
}

function createPostHogDrainAdapter(config: ObservabilityConfig): DrainAdapter | null {
  if (!config.postHogEnabled) return null
  if (!config.postHogApiKey) {
    writeDiagnostic(
      '[observability] PostHog drain enabled but no API key configured; skipping PostHog logs.',
    )
    return null
  }

  const postHogDrain = createPostHogDrain({
    apiKey: config.postHogApiKey,
    distinctId: config.postHogDistinctId,
    eventName: config.postHogEventName,
    host: config.postHogHost,
    mode: config.postHogMode,
    retries: config.postHogRetries,
    timeout: config.postHogTimeoutMs,
  })
  const pipeline = createAdapterPipeline('posthog', config)

  return {
    drain: pipeline(async (batch) => {
      if (!batch.length) return

      await postHogDrain(batch)
    }),
  }
}

function createAdapterPipeline(name: string, config: ObservabilityConfig) {
  return createDrainPipeline<DrainContext>({
    batch: {
      intervalMs: config.batchIntervalMs,
      size: config.batchSize,
    },
    maxBufferSize: config.maxBufferSize,
    onDropped: (events, error) => {
      writeDiagnostic(
        `[observability] ${name} dropped ${events.length} log event(s): ${errorMessage(error)}`,
      )
    },
    retry: {
      backoff: 'exponential',
      initialDelayMs: 1_000,
      maxAttempts: 3,
    },
  })
}

function combineDrainAdapters(
  adapters: readonly DrainAdapter[],
  shouldPersistEvent: ShouldPersistObservabilityEvent,
) {
  const drain = ((context: DrainContext) => {
    if (!shouldPersistEvent(context)) return

    for (const adapter of adapters) {
      adapter.drain(context)
    }
  }) as ((context: DrainContext) => void) & { flush?: () => Promise<void> }

  drain.flush = async () => {
    await Promise.all(adapters.map(flushAdapter))
  }
  Object.defineProperty(drain, 'pending', {
    get: () => pendingEvents(adapters),
  })

  return drain as ObservabilityDrain
}

async function flushAdapter(adapter: DrainAdapter) {
  await adapter.drain.flush()
}

function pendingEvents(adapters: readonly DrainAdapter[]) {
  return adapters.reduce((total, adapter) => total + adapter.drain.pending, 0)
}

function isDrainAdapter(adapter: DrainAdapter | null): adapter is DrainAdapter {
  return adapter !== null
}

function persistEveryEvent() {
  return true
}

// Anchor a relative log dir to the monorepo root so every process (server, web,
// scripts) writes to the same top-level `logs/`, regardless of its own cwd.
// Absolute dirs (env override, tests) pass through untouched.
function resolveLogDir(logDir: string) {
  if (path.isAbsolute(logDir)) return logDir

  const root = monorepoRoot()
  return root ? path.join(root, logDir) : path.resolve(logDir)
}

function monorepoRoot() {
  let dir = process.cwd()

  while (true) {
    if (existsSync(path.join(dir, 'bun.lock'))) return dir

    const parent = path.dirname(dir)
    if (parent === dir) return undefined

    dir = parent
  }
}

function sourcePlugin(source: string) {
  return definePlugin({
    name: `platform.${source}-source`,
    enrich({ event }) {
      if (typeof event.source === 'string') return

      event.source = source
    },
  })
}

function writeDiagnostic(message: string) {
  process.stderr.write(`${message}\n`)
}

// evlog's drain error may be absent; contracts' `errorMessage` would log `undefined`.
function errorMessage(error: Error | undefined) {
  return error?.message ?? 'unknown drain failure'
}
