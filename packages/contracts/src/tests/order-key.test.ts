import { describe, expect, it } from 'vitest'
import { isValidOrderKey, orderKeyBetween } from '../order-key'

describe('order keys', () => {
  it('mints a key strictly between its neighbours', () => {
    const key = orderKeyBetween('b', 'c')

    expect(key).not.toBeNull()
    expect(key! > 'b').toBe(true)
    expect(key! < 'c').toBe(true)
  })

  it('mints keys for the open bounds at either end of the block', () => {
    const top = orderKeyBetween(null, 'b')
    const bottom = orderKeyBetween('y', null)

    expect(top! < 'b').toBe(true)
    expect(bottom! > 'y').toBe(true)
  })

  it('keeps splitting the same gap forever without touching the neighbours', () => {
    let low = 'b'
    const high = 'c'

    for (let step = 0; step < 60; step += 1) {
      const key = orderKeyBetween(low, high)
      expect(key).not.toBeNull()
      expect(key! > low).toBe(true)
      expect(key! < high).toBe(true)
      expect(isValidOrderKey(key!)).toBe(true)
      low = key!
    }
  })

  it('never mints a key that leaves no room before it', () => {
    const keys = [
      orderKeyBetween(null, null),
      orderKeyBetween(null, 'ab'),
      orderKeyBetween('ab', 'b'),
    ]

    for (const key of keys) {
      expect(key).not.toBeNull()
      expect(isValidOrderKey(key!)).toBe(true)
    }
  })

  it('refuses corrupt or inverted bounds instead of minting a key', () => {
    expect(orderKeyBetween('c', 'b')).toBeNull()
    expect(orderKeyBetween('b', 'b')).toBeNull()
    expect(orderKeyBetween('B', 'c')).toBeNull()
    expect(orderKeyBetween('ba', 'c')).toBeNull()
  })
})
