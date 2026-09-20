import { expect, test } from '../../../../test/fixtures'
import { createTraceBuffer } from '../utils/trace-buffer'

test('retains the latest diagnostics in order through wraparound and reset', () => {
  const buffer = createTraceBuffer<number>(5)
  for (let index = 0; index < 10003; index++) buffer.push(index)
  expect(buffer.values()).toEqual([9998, 9999, 10000, 10001, 10002])
  const snapshot = buffer.values()
  buffer.clear()
  buffer.push(42)
  expect(buffer.values()).toEqual([42])
  expect(snapshot).toEqual([9998, 9999, 10000, 10001, 10002])
})
