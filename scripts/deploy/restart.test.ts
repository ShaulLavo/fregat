import { EvlogError } from 'evlog'
import { expect, test } from 'vitest'

import { parseDeployArgs } from './args'
import {
  busyText,
  requestRestart,
  requireStaged,
  restartRefusal,
  type RestartControl,
} from './restart'
import type { SessionId } from '../../packages/contracts/src/chat-ids'
import type { BusySession, ServerRestartResult } from '../../packages/contracts/src/server-update'

const MINUTE = 60_000

function busySession(id: string, title = `Session ${id}`): BusySession {
  return { sessionId: id as SessionId, title, projectTitle: 'platform', state: 'running' }
}

/** Answers each request from `answer`, given the interrupt list it carried and the time. */
function scripted(answer: (interrupt: readonly SessionId[], time: number) => ServerRestartResult) {
  const requests: (readonly SessionId[])[] = []
  const printed: string[] = []
  let time = 0
  const control: RestartControl = {
    request: async (interrupt) => {
      requests.push(interrupt)
      return answer(interrupt, time)
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms
    },
    print: (text) => {
      printed.push(text)
    },
  }
  return { control, requests, printed, elapsed: () => time }
}

const waiting = { interrupt: false, waitMs: 30 * MINUTE, insidePlatform: false }

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof EvlogError)) throw new TypeError('expected a structured script error')
  return error
}

test('an idle server restarts on the first request', async () => {
  const run = scripted(() => ({ restarting: true }))

  await requestRestart(waiting, run.control)

  expect(run.requests).toEqual([[]])
  expect(run.printed).toEqual([])
})

test('busy sessions are waited out and named once', async () => {
  const run = scripted((_, time) =>
    time < 2 * MINUTE ? { restarting: false, busy: [busySession('a')] } : { restarting: true },
  )

  await requestRestart(waiting, run.control)

  expect(run.requests.every((interrupt) => interrupt.length === 0)).toBe(true)
  expect(run.elapsed()).toBeGreaterThanOrEqual(2 * MINUTE)
  expect(run.printed).toHaveLength(1)
  expect(run.printed[0]).toContain('platform › Session a (running)')
})

test('a session busy past the wait gives up without interrupting it', async () => {
  const run = scripted(() => ({ restarting: false, busy: [busySession('a'), busySession('b')] }))

  const error = await failure(requestRestart({ ...waiting, waitMs: 5 * MINUTE }, run.control))

  expect(error.message).toBe('2 sessions stayed busy for 5 minutes, so the server kept running.')
  expect(error.fix).toContain('--interrupt')
  expect(run.requests.every((interrupt) => interrupt.length === 0)).toBe(true)
})

test('--interrupt sends the busy sessions back, and re-sends when another became busy', async () => {
  const run = scripted((interrupt) => {
    if (interrupt.length === 0) return { restarting: false, busy: [busySession('a')] }
    if (interrupt.length === 1)
      return { restarting: false, busy: [busySession('a'), busySession('b')] }
    return { restarting: true }
  })

  await requestRestart({ ...waiting, interrupt: true }, run.control)

  expect(run.requests).toEqual([[], ['a'], ['a', 'b']])
  expect(run.elapsed()).toBe(0)
})

test('sleeping sessions do not hold the restart; their schedules end once the rest is idle', async () => {
  const sleeping: BusySession = { ...busySession('s'), state: 'sleeping' }
  const run = scripted((interrupt, time) => {
    if (interrupt.includes('s' as SessionId)) return { restarting: true }
    if (time < MINUTE) return { restarting: false, busy: [busySession('a'), sleeping] }
    return { restarting: false, busy: [sleeping] }
  })

  await requestRestart(waiting, run.control)

  expect(run.requests.at(-1)).toEqual(['s'])
  expect(run.printed.at(-1)).toContain('ending the schedules of 1 sleeping session')
})

test('inside a Platform chat the busy text says the caller needs --interrupt', () => {
  const text = busyText([busySession('a')], { ...waiting, insidePlatform: true })

  expect(text).toContain('waiting up to 30m for 1 busy session:')
  expect(text).toContain('Rerun with --interrupt')
  expect(busyText([busySession('a')], waiting)).not.toContain('--interrupt')
})

test('nothing staged is an error before any request', async () => {
  expect(requireStaged('/srv/releases/r1', '/srv')).toBe('/srv/releases/r1')
  const error = await failure(Promise.resolve().then(() => requireStaged(null, '/srv')))

  expect(error.message).toBe('No release is staged to restart into.')
})

test("the server's refusal keeps its code, why and fix", () => {
  const unstaged = restartRefusal(409, {
    error: { code: 'update.NO_UPDATE_STAGED', message: 'No update is staged.' },
  })
  const changed = restartRefusal(409, {
    error: {
      code: 'update.STAGED_RELEASE_CHANGED',
      message: 'The staged release changed while the restart was waiting.',
      fix: 'Review the new update, then restart again.',
    },
  })

  expect(unstaged.message).toBe('No release is staged to restart into.')
  expect(changed.message).toContain('409 update.STAGED_RELEASE_CHANGED')
  expect(changed.message).toContain('restart again')
  expect(restartRefusal(403, 'nope').message).toContain('HTTP 403')
})

test('the deploy flags pick a command', () => {
  expect(parseDeployArgs(['--restart'])).toEqual({
    kind: 'restart',
    request: { interrupt: false },
    liveCheck: true,
  })
  expect(parseDeployArgs(['--restart', '--interrupt', '--skip-live-check'])).toEqual({
    kind: 'restart',
    request: { interrupt: true },
    liveCheck: false,
  })
  const both = parseDeployArgs(['--server', '--restart'])
  expect(both.kind === 'deploy' && both.options.restart).toEqual({ interrupt: false })
  const staged = parseDeployArgs(['--server'])
  expect(staged.kind === 'deploy' && staged.options.restart).toBeNull()
  expect(() => parseDeployArgs(['--interrupt'])).toThrow('Add --restart')
  expect(() => parseDeployArgs(['--rollback', '--restart'])).toThrow('Drop --restart')
})
