import { EventEmitter } from 'node:events'
import { expect, test } from 'vitest'

import { FocusRegistry } from '@/commands/state/focus'
import { traceFocus } from '../focus-trace'

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realRequest = FocusRegistry.prototype.request

test('times out while traced', async () => {
  const renderer = Object.assign(new EventEmitter(), { currentFocusedRenderable: null })
  traceFocus({ renderer } as never)
  await new Promise(() => {})
}, 200)

test('the next test sees the real timers and focus registry', () => {
  expect(globalThis.setTimeout).toBe(realSetTimeout)
  expect(globalThis.clearTimeout).toBe(realClearTimeout)
  expect(FocusRegistry.prototype.request).toBe(realRequest)
})
