import path from 'node:path'
import { expect, test } from 'vitest'
import { scratchRoot } from './paths'
import { isPrivateDisplayRuntime, outerWaylandDisplay } from './polaron-display-env'

test('resolves a relative outer Wayland display under the original runtime before isolation', () => {
  const original = { WAYLAND_DISPLAY: 'wayland-1', XDG_RUNTIME_DIR: '/fixture/owner-runtime' }
  const display = outerWaylandDisplay(original)
  const isolated = {
    ...original,
    XDG_RUNTIME_DIR: '/fixture/proof-runtime',
    WAYLAND_DISPLAY: display,
  }
  expect(isolated.WAYLAND_DISPLAY).toBe('/fixture/owner-runtime/wayland-1')
  expect(original.WAYLAND_DISPLAY).toBe('wayland-1')
})

test('preserves an absolute outer display without needing a runtime directory', () => {
  expect(outerWaylandDisplay({ WAYLAND_DISPLAY: '/fixture/outer/wayland-2' })).toBe(
    '/fixture/outer/wayland-2',
  )
})

test('rejects absent display and relative display without original runtime', () => {
  expect(() => outerWaylandDisplay({ XDG_RUNTIME_DIR: '/fixture/runtime' })).toThrow(
    'An outer Wayland display is required',
  )
  expect(() => outerWaylandDisplay({ WAYLAND_DISPLAY: 'wayland-1' })).toThrow(
    'The outer Wayland runtime directory is required',
  )
})

test('limits proof runtimes to direct private directories under the portable scratch root', () => {
  expect(isPrivateDisplayRuntime(path.join(scratchRoot, 'g2d-abc123'))).toBe(true)
  expect(isPrivateDisplayRuntime(path.join(scratchRoot, 'g2d-abc123', 'nested'))).toBe(false)
  expect(isPrivateDisplayRuntime(path.join(scratchRoot, '..', 'g2d-abc123'))).toBe(false)
  expect(isPrivateDisplayRuntime(path.join(scratchRoot, 'foreign'))).toBe(false)
  const runtime = path.join(scratchRoot, 'g2d-abc123')
  expect(isPrivateDisplayRuntime(runtime, path.join(runtime, 'home/tmp'))).toBe(true)
  expect(isPrivateDisplayRuntime(runtime, path.join(runtime, 'home/other'))).toBe(false)
})
