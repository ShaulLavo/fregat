import { describe, expect, it } from 'vitest'
import { machineReleaseRoot } from '../release-root'

describe('release root', () => {
  it('uses the setting when it is set', () => {
    expect(machineReleaseRoot('/srv/fregat', { platform: 'linux', home: '/h', env: {} })).toBe(
      '/srv/fregat',
    )
  })

  it('defaults to the platform application data folder', () => {
    expect(machineReleaseRoot('', { platform: 'darwin', home: '/Users/a', env: {} })).toBe(
      '/Users/a/Library/Application Support/Fregat/releases',
    )
    expect(machineReleaseRoot('', { platform: 'linux', home: '/home/a', env: {} })).toBe(
      '/home/a/.local/share/fregat/releases',
    )
    expect(
      machineReleaseRoot('', {
        platform: 'linux',
        home: '/home/a',
        env: { XDG_DATA_HOME: '/data/a' },
      }),
    ).toBe('/data/a/fregat/releases')
  })
})

describe('release root against the XDG spec', () => {
  it('ignores a relative XDG_DATA_HOME', () => {
    expect(
      machineReleaseRoot('', {
        platform: 'linux',
        home: '/home/a',
        env: { XDG_DATA_HOME: 'data' },
      }),
    ).toBe('/home/a/.local/share/fregat/releases')
  })
})
