import { describe, expect, it } from 'vitest'
import { serviceFromArgv, stateHomeConflictExitCode } from '../service-descriptor'

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

describe('state home conflict exit', () => {
  it('exits 78 for systemd, which RestartPreventExitStatus stops retrying', () => {
    expect(stateHomeConflictExitCode(['bun', 'index.js', '--service=systemd-socket:x'])).toBe(78)
  })

  // KeepAlive.SuccessfulExit=false relaunches any nonzero exit; a clean exit waits for demand.
  it('exits 0 under launchd so the agent does not relaunch into the same refusal', () => {
    expect(
      stateHomeConflictExitCode([
        'bun',
        'index.js',
        '--launchd-socket=Listeners',
        '--service=launchd:x',
      ]),
    ).toBe(0)
  })
})
