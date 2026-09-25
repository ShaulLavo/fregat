import { homedir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultAttachmentsDir } from '../attachments/store'
import { platformCachePath, platformHomePath } from '../home'
import { defaultProviderStatusCacheDir } from '../provider/status-cache'
import { defaultSecretsFilePath, defaultSettingsFilePath } from '../settings/paths'

const stateRoot = '/work/tmp/platform-home-test'
let previous: string | undefined

beforeEach(() => {
  previous = process.env.PLATFORM_HOME
  process.env.PLATFORM_HOME = stateRoot
})

afterEach(() => {
  if (previous === undefined) delete process.env.PLATFORM_HOME
  else process.env.PLATFORM_HOME = previous
})

describe('PLATFORM_HOME', () => {
  it('moves every state path', () => {
    expect([
      defaultSettingsFilePath(),
      defaultSecretsFilePath(),
      defaultAttachmentsDir(),
      defaultProviderStatusCacheDir(),
      platformHomePath('fs-metadata.sqlite'),
      platformHomePath('wallpapers'),
    ]).toEqual([
      path.join(stateRoot, 'settings.json'),
      path.join(stateRoot, 'secrets.json'),
      path.join(stateRoot, 'attachments'),
      path.join(stateRoot, 'provider-status'),
      path.join(stateRoot, 'fs-metadata.sqlite'),
      path.join(stateRoot, 'wallpapers'),
    ])
  })

  it('leaves download caches in the user home', () => {
    expect(platformCachePath('lsp')).toBe(path.join(homedir(), '.platform', 'lsp'))
  })

  it('falls back to ~/.platform when unset', () => {
    delete process.env.PLATFORM_HOME
    expect(platformHomePath('settings.json')).toBe(
      path.join(homedir(), '.platform', 'settings.json'),
    )
  })
})
