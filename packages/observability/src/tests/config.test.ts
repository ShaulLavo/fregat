import { describe, expect, it } from 'vitest'

import { observabilityConfigFromEnv } from '../config'

describe('observability config', () => {
  it('uses production defaults for balanced file logging', () => {
    const config = observabilityConfigFromEnv({ NODE_ENV: 'production' })

    expect(config).toMatchObject({
      consoleEnabled: false,
      debugSampleRate: 0,
      enabled: true,
      environment: 'production',
      filePretty: false,
      infoSampleRate: 100,
      logDir: 'logs',
      maxBufferSize: 1_000,
      maxFiles: 60,
      maxSizePerFile: 10_485_760,
      postHogEnabled: false,
      postHogEventName: 'platform_log',
      postHogHost: 'https://us.i.posthog.com',
      postHogMode: 'logs',
      postHogRetries: 2,
      postHogTimeoutMs: 5_000,
      slowMs: 500,
    })
  })

  it('disables observability by default during tests', () => {
    const config = observabilityConfigFromEnv({ NODE_ENV: 'test' })

    expect(config.enabled).toBe(false)
    expect(config.consoleEnabled).toBe(true)
    expect(config.infoSampleRate).toBe(100)
  })

  it('honors public environment overrides', () => {
    const config = observabilityConfigFromEnv({
      NODE_ENV: 'production',
      OBSERVABILITY_CONSOLE: 'true',
      OBSERVABILITY_DIR: '/tmp/platform-logs',
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_FILE_PRETTY: 'true',
      OBSERVABILITY_INFO_SAMPLE_RATE: '5',
      OBSERVABILITY_MAX_FILES: '3',
      OBSERVABILITY_MAX_SIZE_BYTES: '1024',
      OBSERVABILITY_POSTHOG_API_KEY: 'phc_test',
      OBSERVABILITY_POSTHOG_DISTINCT_ID: 'platform-server',
      OBSERVABILITY_POSTHOG_ENABLED: 'true',
      OBSERVABILITY_POSTHOG_EVENT_NAME: 'platform_server_log',
      OBSERVABILITY_POSTHOG_HOST: 'https://eu.i.posthog.com',
      OBSERVABILITY_POSTHOG_MODE: 'events',
      OBSERVABILITY_POSTHOG_RETRIES: '4',
      OBSERVABILITY_POSTHOG_TIMEOUT_MS: '1500',
      OBSERVABILITY_SLOW_MS: '250',
    })

    expect(config).toMatchObject({
      consoleEnabled: true,
      enabled: true,
      filePretty: true,
      infoSampleRate: 5,
      logDir: '/tmp/platform-logs',
      maxFiles: 3,
      maxSizePerFile: 1024,
      postHogApiKey: 'phc_test',
      postHogDistinctId: 'platform-server',
      postHogEnabled: true,
      postHogEventName: 'platform_server_log',
      postHogHost: 'https://eu.i.posthog.com',
      postHogMode: 'events',
      postHogRetries: 4,
      postHogTimeoutMs: 1500,
      slowMs: 250,
    })
  })

  it('ignores removed filesystem observability environment variables', () => {
    const config = observabilityConfigFromEnv({
      FS_OBSERVABILITY_DIR: '/tmp/legacy-platform-logs',
      FS_OBSERVABILITY_ENABLED: 'false',
      FS_OBSERVABILITY_POSTHOG_API_KEY: 'phc_legacy',
      NODE_ENV: 'production',
    })

    expect(config).toMatchObject({
      enabled: true,
      logDir: 'logs',
      postHogApiKey: '',
      postHogEnabled: false,
    })
  })

  it('enables PostHog from standard PostHog environment variables', () => {
    const config = observabilityConfigFromEnv({
      NODE_ENV: 'production',
      POSTHOG_API_KEY: 'phc_standard',
      POSTHOG_HOST: 'https://us.i.posthog.com',
    })

    expect(config).toMatchObject({
      postHogApiKey: 'phc_standard',
      postHogEnabled: true,
      postHogHost: 'https://us.i.posthog.com',
    })
  })
})
