import { describe } from 'vitest'

import {
  copyDiagnosticPeekClientRect,
  diagnosticPeekPlacement,
} from '@shaulavo/workbench-editor/lsp'
import { expect, test } from '../../../../../test/fixtures'

const layerRect = rect(100, 50, 500, 400)
const clipRect = rect(120, 70, 460, 350)

describe('diagnosticPeekPlacement', () => {
  test('copies mutable browser rectangles into frozen plain data', () => {
    const source = rect(10, 20, 30, 40)
    const copy = copyDiagnosticPeekClientRect(source)

    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(Object.isFrozen(copy)).toBe(true)
  })

  test('places below the anchor and translates client coordinates into the layer', () => {
    expect(
      diagnosticPeekPlacement({
        anchorRect: rect(180, 120, 220, 20),
        clipRect,
        layerRect,
        surfaceHeight: 80,
        surfaceWidth: 180,
      }),
    ).toEqual({ left: 80, top: 96 })
  })

  test('flips above and clamps both horizontal edges', () => {
    expect(
      diagnosticPeekPlacement({
        anchorRect: rect(440, 330, 20, 20),
        clipRect,
        layerRect,
        surfaceHeight: 100,
        surfaceWidth: 180,
      }),
    ).toEqual({ left: 300, top: 174 })

    expect(
      diagnosticPeekPlacement({
        anchorRect: rect(80, 100, 20, 20),
        clipRect,
        layerRect,
        surfaceHeight: 40,
        surfaceWidth: 500,
      }),
    ).toEqual({ left: 20, top: 76 })
  })
})

function rect(left: number, top: number, width: number, height: number) {
  return { bottom: top + height, height, left, right: left + width, top, width }
}
