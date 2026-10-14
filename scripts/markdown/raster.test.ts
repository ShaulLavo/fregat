import { expect, test } from 'vitest'
import { negativeControls, nonblankPixels, pixelDifference } from './raster'

test('a flat screenshot fails the raster content control', () => {
  expect(nonblankPixels({ width: 4, height: 4, data: new Uint8Array(64).fill(255) })).toBe(0)
  expect(negativeControls()).toBe(true)
})

test('a same-size color change with identical nonblank counts is still detected', () => {
  const first = new Uint8Array(64).fill(255)
  const second = first.slice()
  first[0] = 0
  second[1] = 0
  expect(nonblankPixels({ width: 4, height: 4, data: first })).toBe(
    nonblankPixels({ width: 4, height: 4, data: second }),
  )
  expect(
    pixelDifference({ width: 4, height: 4, data: first }, { width: 4, height: 4, data: second })
      .changedPixels,
  ).toBe(1)
})
