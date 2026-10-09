import { expect, test } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { onRenderableResize } from '@/utils/renderable-events'

test('reads the actual OpenTUI renderable when initial layout and resize call the handler', async () => {
  const sizes: { width: number; height: number }[] = []
  const frame = await renderTui(
    <box
      flexGrow={1}
      onSizeChange={onRenderableResize((view) => {
        sizes.push({ width: view.width, height: view.height })
      })}
    />,
    { width: 30, height: 8, useThread: false },
  )
  try {
    await frame.renderOnce()
    expect(sizes.at(-1)).toEqual({ width: 30, height: 8 })
    frame.resize(42, 12)
    await frame.renderOnce()
    expect(sizes.at(-1)).toEqual({ width: 42, height: 12 })
  } finally {
    await frame.cleanup()
  }
})
