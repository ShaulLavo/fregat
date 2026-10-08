import { pairingLink } from '@workspace/contracts'
import { expect, test } from 'vitest'

import { deviceKind, deviceLabel } from '@/lib/pairing/utils/device-label'
import { normalizePairingCode } from '@/components/utils/pairing-code'
import { pairingCodeFromLink } from '@/lib/pairing/utils/link'

test('a pairing link carries its code in the fragment and reads back', () => {
  const link = pairingLink('https://omarchy.mesh.example/platform/', 'ABCDEFGHJKLM')
  const url = new URL(link)

  expect(url.pathname).toBe('/platform/pair')
  expect(url.search).toBe('')
  expect(pairingCodeFromLink(url.pathname, url.hash)).toBe('ABCDEFGHJKLM')
  expect(pairingCodeFromLink('/platform/', url.hash)).toBeNull()
})

test('a typed code ignores case, spaces and dashes, and refuses the symbols it never uses', () => {
  expect(normalizePairingCode('abcd-efgh jklm')).toBe('ABCDEFGHJKLM')
  expect(normalizePairingCode('ABCDEFGHJKL0')).toBeNull()
  expect(normalizePairingCode('ABC')).toBeNull()
})

test('a device is named by its system and browser', () => {
  expect(
    deviceLabel(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
    ),
  ).toBe('iPhone · Safari')
  expect(
    deviceLabel(
      'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
    ),
  ).toBe('Android · Chrome')
})

test('the pairing screen calls a device a phone, a tablet or a browser', () => {
  const iPhone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15'
  const androidTablet =
    'Mozilla/5.0 (Linux; Android 16; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

  expect(deviceKind(iPhone, 5)).toBe('phone')
  expect(deviceKind(androidTablet, 5)).toBe('tablet')
  // iPadOS Safari reports a Mac; only its touch screen tells them apart.
  expect(deviceKind(mac, 5)).toBe('tablet')
  expect(deviceKind(mac, 0)).toBe('browser')
})
