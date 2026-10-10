import { vi } from 'vitest'
import { test, expect } from './fixtures'
import { useCompilerProbe, type CompilerProbeOwner } from './factories/use-compiler-probe'
import { renderHookWithProviders } from './render'

test('compiler caches stable-owner reads and invalidates revision-bound snapshots', async ({
  client,
}) => {
  expect((await client.health.get()).status).toBe(200)
  let value = 'first'
  const owner: CompilerProbeOwner = {
    read: vi.fn(() => value),
    readSnapshot: vi.fn((revision) => ({ revision, value })),
  }
  const rendered = renderHookWithProviders(
    ({ owner, revision }) => useCompilerProbe(owner, revision),
    { initialProps: { owner, revision: 1 } },
  )
  const initial = rendered.result.current
  rendered.rerender({ owner, revision: 1 })
  expect(rendered.result.current).toBe(initial)
  expect(owner.read).toHaveBeenCalledTimes(1)
  expect(owner.readSnapshot).toHaveBeenCalledTimes(1)

  value = 'second'
  rendered.rerender({ owner, revision: 2 })
  expect(rendered.result.current.opaque).toBe('first')
  expect(rendered.result.current.observed).toEqual({ revision: 2, value: 'second' })
  expect(owner.read).toHaveBeenCalledTimes(1)
  expect(owner.readSnapshot).toHaveBeenCalledTimes(2)

  const replacement: CompilerProbeOwner = {
    read: vi.fn(() => value),
    readSnapshot: vi.fn((revision) => ({ revision, value })),
  }
  rendered.rerender({ owner: replacement, revision: 2 })
  expect(rendered.result.current.opaque).toBe('second')
  expect(replacement.read).toHaveBeenCalledTimes(1)
  rendered.unmount()
})
