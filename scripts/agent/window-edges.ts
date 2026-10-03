import type { Page } from 'playwright'
import type { Evidence } from './evidence'

export async function captureWindowEdges(page: Page, evidence: Evidence, label: string) {
  const boxes = await page.evaluate(() => {
    const width = innerWidth
    const height = innerHeight
    return Array.from(document.querySelectorAll('*')).flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return []
      const edges = [
        rect.top <= 0 && rect.bottom > 0 && 'top',
        rect.left < width && rect.right >= width && 'right',
        rect.top < height && rect.bottom >= height && 'bottom',
        rect.left <= 0 && rect.right > 0 && 'left',
      ].filter(Boolean)
      if (edges.length === 0) return []
      const style = getComputedStyle(element)
      return [
        {
          tag: element.tagName,
          id: element.id,
          className: element.getAttribute('class'),
          edges,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          border: [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft],
          borderWidths: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          outline: style.outline,
          outlineStyle: style.outlineStyle,
          outlineOffset: style.outlineOffset,
          shadow: style.boxShadow,
          background: style.backgroundColor,
          backdrop: style.backdropFilter,
          radius: style.borderRadius,
          transition: style.transition,
        },
      ]
    })
  })
  await evidence.json(`${label}-edge-boxes.json`, boxes)
  const png = await page.screenshot({
    path: evidence.file(`${label}-edges.png`),
    omitBackground: true,
  })
  const sampled = await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${base64}`)).blob(),
    )
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const { width, height } = canvas
    const pixels = context.getImageData(0, 0, width, height).data
    const pixel = (x: number, y: number) =>
      Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4))
    const rows = Array.from({ length: 3 }, (_, offset) => ({
      offset,
      top: Array.from({ length: width }, (_, x) => pixel(x, offset)),
      bottom: Array.from({ length: width }, (_, x) => pixel(x, height - 1 - offset)),
      left: Array.from({ length: height }, (_, y) => pixel(offset, y)),
      right: Array.from({ length: height }, (_, y) => pixel(width - 1 - offset, y)),
    }))
    const zoom = document.createElement('canvas')
    zoom.width = Math.max(width, height) * 4
    zoom.height = 96
    const zoomContext = zoom.getContext('2d')!
    zoomContext.imageSmoothingEnabled = false
    zoomContext.drawImage(canvas, 0, 0, width, 3, 0, 0, width * 4, 24)
    zoomContext.drawImage(canvas, 0, height - 3, width, 3, 0, 24, width * 4, 24)
    zoomContext.translate(0, 72)
    zoomContext.rotate(-Math.PI / 2)
    zoomContext.drawImage(canvas, 0, 0, 3, height, 0, 0, 24, height * 4)
    zoomContext.drawImage(canvas, width - 3, 0, 3, height, -24, 0, 24, height * 4)
    return { width, height, rows, zoom: zoom.toDataURL('image/png').split(',')[1]! }
  }, png.toString('base64'))
  const { zoom, ...pixels } = sampled
  await evidence.json(`${label}-edge-pixels.json`, pixels)
  await evidence.write(`${label}-edges-zoom.png`, Buffer.from(zoom, 'base64'))
  return { boxes, pixels }
}
