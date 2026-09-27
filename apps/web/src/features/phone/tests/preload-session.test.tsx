import { afterEach } from 'vitest'
import { expect, test } from '../../../../test/fixtures'

import { SHELL_CHUNKS_ID } from '@/lib/boot-keys'
import { preloadSession } from '@/features/phone/utils/preload-session'

afterEach(() => document.head.replaceChildren())

test('warms only conversation modules at low priority and reuses existing hints', () => {
  const manifest = document.createElement('script')
  manifest.id = SHELL_CHUNKS_ID
  manifest.type = 'application/json'
  manifest.textContent = JSON.stringify({
    session: ['/shared.js', '/conversation.js'],
    workbench: ['/editor.js'],
    sessions: ['/list.js'],
  })
  const existing = document.createElement('link')
  existing.rel = 'modulepreload'
  existing.href = '/shared.js'
  document.head.append(manifest, existing)
  preloadSession()
  preloadSession()
  const hints = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[data-phone-warm-session]'),
  )
  expect(hints.map((link) => new URL(link.href).pathname)).toEqual(['/conversation.js'])
  expect(hints.map((link) => link.rel)).toEqual(['modulepreload'])
  expect(hints.every((link) => link.fetchPriority === 'low' && link.crossOrigin === '')).toBe(true)
  expect(document.querySelectorAll('script[src]')).toHaveLength(0)
})

test('unbundled development has no production preload hints', () => {
  preloadSession()
  expect(document.querySelectorAll('link')).toHaveLength(0)
})
