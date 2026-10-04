import { expect, test } from 'vitest'

import { allowedDuringQuiet, jobsAhead } from './admission'

const queue = [
  { id: 'browser', jobClass: 'browser', quiet: false },
  { id: 'measurement', jobClass: 'light', quiet: true },
  { id: 'first', jobClass: 'light', quiet: false },
  { id: 'suite', jobClass: 'suite', quiet: false },
  { id: 'second', jobClass: 'light', quiet: false },
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
