import { describe, expect, it } from 'vitest'
import { MinimapCharRendererFactory } from '../src/minimapCharRendererFactory'
import { Constants } from '../src/minimapCharSheet'
import type { RGBA8 } from '../src/types'

describe('MinimapCharRenderer', () => {
  it('renders block characters into image data', () => {
    const renderer = MinimapCharRendererFactory.createFromSampleData(sampleData(), 1)
    const imageData = fakeImageData(Constants.BASE_CHAR_WIDTH, Constants.BASE_CHAR_HEIGHT)
    const background: RGBA8 = { r: 0, g: 0, b: 0, a: 255 }
    const color: RGBA8 = { r: 255, g: 255, b: 255, a: 255 }

    renderer.blockRenderChar(imageData, 0, 0, color, 255, background, 255, false)

    expect([...imageData.data]).toEqual([128, 128, 128, 255, 128, 128, 128, 255])
  })

  it('renders sampled text characters', () => {
    const renderer = MinimapCharRendererFactory.createFromSampleData(sampleData(), 1)
    const imageData = fakeImageData(Constants.BASE_CHAR_WIDTH, Constants.BASE_CHAR_HEIGHT)
    const background: RGBA8 = { r: 0, g: 0, b: 0, a: 255 }
    const color: RGBA8 = { r: 255, g: 255, b: 255, a: 255 }

    renderer.renderChar(
      imageData,
      0,
      0,
      'd'.charCodeAt(0),
      color,
      255,
      background,
      255,
      1,
      false,
      false,
    )

    expect(imageData.data[3]).toBe(255)
    expect(imageData.data[7]).toBe(255)
    expect(imageData.data[0]).toBeGreaterThan(0)
  })
})

function sampleData(): Uint8ClampedArray {
  const result = new Uint8ClampedArray(
    Constants.SAMPLED_CHAR_HEIGHT *
      Constants.SAMPLED_CHAR_WIDTH *
      Constants.RGBA_CHANNELS_CNT *
      Constants.CHAR_COUNT,
  )
  const dIndex = 'd'.charCodeAt(0) - Constants.START_CH_CODE

  for (let y = 0; y < Constants.SAMPLED_CHAR_HEIGHT; y += 1) {
    const row = y * Constants.RGBA_SAMPLED_ROW_WIDTH
    for (let x = 0; x < Constants.SAMPLED_CHAR_WIDTH; x += 1) {
      const offset = row + (dIndex * Constants.SAMPLED_CHAR_WIDTH + x) * Constants.RGBA_CHANNELS_CNT
      result[offset] = 255
      result[offset + 1] = 255
      result[offset + 2] = 255
      result[offset + 3] = x > 2 && x < 7 && y > 2 && y < 13 ? 255 : 0
    }
  }

  return result
}

function fakeImageData(width: number, height: number): ImageData {
  return {
    colorSpace: 'srgb',
    width,
    height,
    data: new Uint8ClampedArray(width * height * Constants.RGBA_CHANNELS_CNT),
  }
}
