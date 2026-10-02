import { describe, expect, it } from 'vitest'
import { serviceFromArgv } from '../service-descriptor'

describe('service descriptor', () => {
  it('reads the supervisor the unit names', () => {
    expect(serviceFromArgv(['bun', 'index.js', '--service=launchd:dev.fregat.server'])).toEqual({
      kind: 'launchd',
      registrationId: 'dev.fregat.server',
    })
  })

  it('treats a hand-started server as unmanaged', () => {
    expect(serviceFromArgv(['bun', 'index.js'])).toEqual({
      kind: 'unmanaged',
      registrationId: null,
    })
  })

  it('refuses an unknown supervisor', () => {
    expect(() => serviceFromArgv(['--service=cron:job'])).toThrow(
      expect.objectContaining({ code: 'system.ACTIVATION_INVALID' }),
    )
  })
})
