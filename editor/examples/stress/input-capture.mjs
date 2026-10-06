import { fail } from './errors.mjs'

export async function captureInputView(page) {
  const clip = await page.locator('#view-0').boundingBox()
  const viewport = page.viewportSize()
  if (
    !clip ||
    !viewport ||
    clip.width <= 0 ||
    clip.height <= 0 ||
    clip.x < 0 ||
    clip.y < 0 ||
    clip.x + clip.width > viewport.width ||
    clip.y + clip.height > viewport.height
  )
    fail('Input screenshot requires its complete view inside the viewport')
  const x = Math.floor(clip.x + 0.001)
  const y = Math.floor(clip.y + 0.001)
  return page.screenshot({
    clip: {
      x,
      y,
      width: Math.ceil(clip.x + clip.width - 0.001) - x,
      height: Math.ceil(clip.y + clip.height - 0.001) - y,
    },
    animations: 'disabled',
  })
}
