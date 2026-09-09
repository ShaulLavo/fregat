import { vi } from 'vitest'

import { MountedEditorRegistry } from '@/features/editor/state/mounted-editor-registry'
import { expect, test } from '../../../../../test/fixtures'

test('does not publish a false mounted-editor transition during a StrictMode replay', async () => {
  const registry = new MountedEditorRegistry()
  const listener = vi.fn()
  registry.subscribe(listener)

  const unregister = registry.register('/repo/a.ts')
  unregister()
  registry.register('/repo/a.ts')
  await Promise.resolve()

  expect(listener.mock.calls).toEqual([['/repo/a.ts', true]])
  expect(registry.has('/repo/a.ts')).toBe(true)
})

test('publishes a real last-owner unmount after the replay window', async () => {
  const registry = new MountedEditorRegistry()
  const listener = vi.fn()
  registry.subscribe(listener)

  const first = registry.register('/repo/a.ts')
  const second = registry.register('/repo/a.ts')
  first()
  second()
  await Promise.resolve()

  expect(listener.mock.calls).toEqual([
    ['/repo/a.ts', true],
    ['/repo/a.ts', false],
  ])
  expect(registry.has('/repo/a.ts')).toBe(false)
})
