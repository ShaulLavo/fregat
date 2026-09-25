import { afterEach, expect, test, vi } from 'vitest'
import {
  loadedMarkdownExtensions,
  loadMarkdownExtension,
  setMarkdownExtensionLoaders,
} from '../extensions'

afterEach(() => setMarkdownExtensionLoaders(null))

test('extension requests share acquisition and keep a stable frozen derived snapshot', async () => {
  const raw = vi.fn(() => import('rehype-raw'))
  setMarkdownExtensionLoaders({ raw })
  const before = loadedMarkdownExtensions()
  const [first, second] = await Promise.all([
    loadMarkdownExtension('raw'),
    loadMarkdownExtension('raw'),
  ])
  expect(raw).toHaveBeenCalledTimes(1)
  expect(first).toBe(second)
  expect(first).not.toBe(before)
  expect(Object.isFrozen(first)).toBe(true)
  expect(loadedMarkdownExtensions()).toBe(first)
  const withMath = await loadMarkdownExtension('math')
  expect(withMath.raw).toBe(first.raw)
  expect(withMath.math).not.toBeNull()
  expect(await loadMarkdownExtension('raw')).toBe(withMath)
})

test('failed extension acquisition keeps the fallback and a later document can retry', async () => {
  const raw = vi
    .fn(() => import('rehype-raw'))
    .mockRejectedValueOnce(new Error('fixture import failure'))
  setMarkdownExtensionLoaders({ raw })
  const before = loadedMarkdownExtensions()
  expect(await loadMarkdownExtension('raw')).toBe(before)
  expect((await loadMarkdownExtension('raw')).raw).not.toBeNull()
  expect(raw).toHaveBeenCalledTimes(2)
})
