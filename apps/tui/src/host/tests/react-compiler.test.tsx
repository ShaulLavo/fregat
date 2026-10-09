import { act } from 'react'

import { expect, test } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { CompilerProbe, type CompilerControls } from '../../../test/factories/compiler-probe'

test('compiled terminal components reuse children and still apply state and prop changes', async () => {
  let controls: CompilerControls | undefined
  let childRenders = 0
  const frame = await renderTui(
    <CompilerProbe
      ready={(value) => {
        controls = value
      }}
      record={() => {
        childRenders += 1
      }}
    />,
    { width: 30, height: 4, useThread: false },
  )
  try {
    expect(controls).toBeDefined()
    if (!controls) return
    const update = controls
    const initialRenders = childRenders
    await act(async () => {
      update.tick()
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('tick:1')
    expect(childRenders).toBe(initialRenders)

    await act(async () => {
      update.label('beta')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('beta')
    expect(frame.captureCharFrame()).not.toContain('alpha')
    expect(childRenders).toBe(initialRenders + 1)
  } finally {
    await frame.cleanup()
  }
})
