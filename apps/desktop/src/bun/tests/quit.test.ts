import { expect, test } from 'vitest'
import applicationEvents from '../../../.hutch/devkit/api/sdks/main/events/ApplicationEvents'
import { createQuitHandler } from '../quit'

test('quit is cancelled synchronously until cleanup finishes, including repeated requests', async () => {
  const cleanup = Promise.withResolvers<void>()
  const exited = Promise.withResolvers<void>()
  let cleanupCount = 0
  let exitCount = 0
  const handler = createQuitHandler({
    cleanup: () => {
      cleanupCount += 1
      return cleanup.promise
    },
    quit: () => {
      const finalEvent = applicationEvents.beforeQuit({})
      handler(finalEvent)
      expect(finalEvent.responseWasSet).toBe(false)
      exitCount += 1
      exited.resolve()
    },
    reportError: (error) => {
      throw error
    },
  })
  const first = applicationEvents.beforeQuit({})
  handler(first)
  expect(first.responseWasSet).toBe(true)
  expect(first.response).toEqual({ allow: false })
  const repeated = applicationEvents.beforeQuit({})
  handler(repeated)
  expect(repeated.response).toEqual({ allow: false })
  expect(cleanupCount).toBe(1)
  expect(exitCount).toBe(0)
  cleanup.resolve()
  await exited.promise
  expect(exitCount).toBe(1)
})

test('a cleanup failure is reported before allowing the final quit', async () => {
  const completed = Promise.withResolvers<void>()
  const failure = new TypeError('cleanup failed')
  const events: unknown[] = []
  const handler = createQuitHandler({
    cleanup: () => Promise.reject(failure),
    reportError: (error) => {
      events.push(error)
    },
    quit: () => {
      events.push('quit')
      completed.resolve()
    },
  })
  const event = applicationEvents.beforeQuit({})
  handler(event)
  expect(event.response).toEqual({ allow: false })
  await completed.promise
  expect(events).toEqual([failure, 'quit'])
})
