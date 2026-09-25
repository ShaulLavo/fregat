import {
  booleanFromEnv,
  observabilityEnabledFromEnv,
  observabilityEnv,
  observabilityEnvironment,
  type ObservabilityEnv,
  type ObservabilityEnvironment,
} from './env'

export type { ObservabilityEnv, ObservabilityEnvironment }

export type ObservabilityPostHogMode = 'events' | 'logs'

export type ObservabilityConfig = {
  batchIntervalMs: number
  batchSize: number
  consoleEnabled: boolean
  debugSampleRate: number
  enabled: boolean
  environment: ObservabilityEnvironment
  filePretty: boolean
  infoSampleRate: number
  logDir: string
  maxBufferSize: number
  maxFiles: number
  maxSizePerFile: number
  postHogApiKey: string
  postHogDistinctId: string | undefined
  postHogEnabled: boolean
  postHogEventName: string
  postHogHost: string
  postHogMode: ObservabilityPostHogMode
  postHogRetries: number
  postHogTimeoutMs: number
  service: string
  slowMs: number
}

const DEFAULT_BATCH_INTERVAL_MS = 5_000
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_LOG_DIR = 'logs'
const DEFAULT_MAX_BUFFER_SIZE = 1_000
// Counted in files, not days: at full info logging a busy day fills three.
const DEFAULT_MAX_FILES = 60
const DEFAULT_MAX_SIZE_PER_FILE = 10_485_760
const DEFAULT_POSTHOG_EVENT_NAME = 'platform_log'
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const DEFAULT_POSTHOG_RETRIES = 2
const DEFAULT_POSTHOG_TIMEOUT_MS = 5_000
const DEFAULT_SLOW_MS = 500

export function observabilityConfigFromEnv(
  env: ObservabilityEnv = process.env,
): ObservabilityConfig {
  const environment = observabilityEnvironment(env)
  const enabled = observabilityEnabledFromEnv(env)
  const postHogApiKey = stringFromEnv(
    observabilityEnv(env, 'POSTHOG_API_KEY'),
    env.POSTHOG_API_KEY,
    env.NUXT_POSTHOG_API_KEY,
  )
  const production = environment === 'production'

  return {
    batchIntervalMs: positiveInteger(
      observabilityEnv(env, 'BATCH_INTERVAL_MS'),
      DEFAULT_BATCH_INTERVAL_MS,
    ),
    batchSize: positiveInteger(observabilityEnv(env, 'BATCH_SIZE'), DEFAULT_BATCH_SIZE),
    consoleEnabled: booleanFromEnv(observabilityEnv(env, 'CONSOLE')) ?? !production,
    debugSampleRate: production ? 0 : 100,
    enabled,
    environment,
    filePretty: booleanFromEnv(observabilityEnv(env, 'FILE_PRETTY')) ?? false,
    // Info is kept whole: these logs are the debugging record of one machine, and a sampled
    // wide event is a missing one.
    infoSampleRate: percentage(observabilityEnv(env, 'INFO_SAMPLE_RATE'), 100),
    logDir: observabilityEnv(env, 'DIR')?.trim() || DEFAULT_LOG_DIR,
    maxBufferSize: positiveInteger(
      observabilityEnv(env, 'MAX_BUFFER_SIZE'),
      DEFAULT_MAX_BUFFER_SIZE,
    ),
    maxFiles: positiveInteger(observabilityEnv(env, 'MAX_FILES'), DEFAULT_MAX_FILES),
    maxSizePerFile: positiveInteger(
      observabilityEnv(env, 'MAX_SIZE_BYTES'),
      DEFAULT_MAX_SIZE_PER_FILE,
    ),
    postHogApiKey,
    postHogDistinctId: optionalStringFromEnv(observabilityEnv(env, 'POSTHOG_DISTINCT_ID')),
    postHogEnabled:
      booleanFromEnv(observabilityEnv(env, 'POSTHOG_ENABLED')) ?? Boolean(postHogApiKey),
    postHogEventName:
      stringFromEnv(observabilityEnv(env, 'POSTHOG_EVENT_NAME')) || DEFAULT_POSTHOG_EVENT_NAME,
    postHogHost:
      stringFromEnv(
        observabilityEnv(env, 'POSTHOG_HOST'),
        env.POSTHOG_HOST,
        env.NUXT_POSTHOG_HOST,
      ) || DEFAULT_POSTHOG_HOST,
    postHogMode: postHogMode(observabilityEnv(env, 'POSTHOG_MODE')),
    postHogRetries: nonNegativeInteger(
      observabilityEnv(env, 'POSTHOG_RETRIES'),
      DEFAULT_POSTHOG_RETRIES,
    ),
    postHogTimeoutMs: positiveInteger(
      observabilityEnv(env, 'POSTHOG_TIMEOUT_MS'),
      DEFAULT_POSTHOG_TIMEOUT_MS,
    ),
    service: observabilityEnv(env, 'SERVICE')?.trim() || 'platform',
    slowMs: positiveInteger(observabilityEnv(env, 'SLOW_MS'), DEFAULT_SLOW_MS),
  }
}

function stringFromEnv(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }

  return ''
}

function optionalStringFromEnv(...values: Array<string | undefined>) {
  const value = stringFromEnv(...values)
  return value || undefined
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback

  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback

  return parsed
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback

  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) return fallback

  return parsed
}

function percentage(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback

  return Math.max(0, Math.min(100, parsed))
}

function postHogMode(value: string | undefined): ObservabilityPostHogMode {
  if (value?.trim().toLowerCase() === 'events') return 'events'

  return 'logs'
}
