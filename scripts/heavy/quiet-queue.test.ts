import { expect, test } from 'vitest'

import { allowedDuringQuiet, jobsAhead } from './admission'

const queue = [
  { id: 'browser', jobClass: 'browser', quiet: false, server: false },
  { id: 'measurement', jobClass: 'light', quiet: true, server: false },
  { id: 'first', jobClass: 'light', quiet: false, server: false },
  { id: 'suite', jobClass: 'suite', quiet: false, server: false },
  { id: 'second', jobClass: 'light', quiet: false, server: false },
]

test('active wrapper holds retain FIFO among eligible light jobs', () => {
  expect(jobsAhead(queue, queue[2]!, true, ['light'])).toBe(0)
  expect(jobsAhead(queue, queue[4]!, true, ['light'])).toBe(1)
  expect(jobsAhead(queue, queue[3]!, true, ['light'])).toBe(3)
  expect(allowedDuringQuiet(queue[1]!, ['light'])).toBe(false)
})

test('ordinary admission, expired holds and disabled concurrency retain full FIFO', () => {
  expect(jobsAhead(queue, queue[2]!, false, ['light'])).toBe(2)
  expect(jobsAhead(queue, queue[4]!, false, ['light'])).toBe(4)
  expect(jobsAhead(queue, queue[2]!, true, [])).toBe(2)
  expect(allowedDuringQuiet(queue[2]!, [])).toBe(false)
})

test('new light servers wait during a hold while finite light jobs pass them', () => {
  const server = { id: 'server', jobClass: 'light', quiet: false, server: true }
  const waiting = [server, ...queue]
  expect(allowedDuringQuiet(server, ['light'])).toBe(false)
  expect(jobsAhead(waiting, queue[2]!, true, ['light'])).toBe(0)
  expect(jobsAhead(waiting, queue[4]!, true, ['light'])).toBe(1)
  expect(jobsAhead(waiting, queue[2]!, false, ['light'])).toBe(3)
})
