import { expect, test } from 'vitest'
import '../src/style.css'
import {
  measureBrowserTextMetrics,
  observeBrowserTextMetricsInvalidation,
} from '../src/virtualization/browserMetrics'

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

test('font invalidation can resize an observed ancestor without dropping its resize notification', async () => {
  const host = document.createElement('div')
  host.className = 'editor-virtualized'
  host.style.cssText = 'width:640px;height:240px;box-sizing:border-box;font:13px monospace'
  document.body.append(host)
  const errors: string[] = []
  const onError = (event: ErrorEvent) => errors.push(event.message)
  window.addEventListener('error', onError)
  let contentWidth = 0
  let invalidations = 0
  const viewport = new ResizeObserver(([entry]) => {
    contentWidth = entry!.contentRect.width
  })
  viewport.observe(host)
  const face = observeBrowserTextMetricsInvalidation(host, () => {
    invalidations++
    const metrics = measureBrowserTextMetrics(host)
    host.style.paddingRight = `${Math.ceil(metrics.characterWidth * 10)}px`
  })
  try {
    await frames()
    await expect.poll(() => contentWidth).toBeLessThan(640)
    const initialWidth = contentWidth
    expect(invalidations).toBeGreaterThan(0)
    expect(errors).toEqual([])

    host.style.fontSize = '26px'
    await frames()
    await expect.poll(() => contentWidth).toBeLessThan(initialWidth)
    expect(invalidations).toBe(2)
    expect(contentWidth).toBeCloseTo(640 - Number.parseFloat(host.style.paddingRight), 3)
    expect(errors).toEqual([])
  } finally {
    face.dispose()
    viewport.disconnect()
    window.removeEventListener('error', onError)
    host.remove()
  }
})

test('a font listener can dispose a second editor before its pending notification', async () => {
  const first = document.createElement('div')
  const second = document.createElement('div')
  for (const host of [first, second]) {
    host.className = 'editor-virtualized'
    host.style.cssText = 'width:640px;height:240px;font:13px monospace'
    document.body.append(host)
  }
  const calls: string[] = []
  const firstFace = observeBrowserTextMetricsInvalidation(first, () => {
    calls.push('first')
    secondFace.dispose()
  })
  const secondFace = observeBrowserTextMetricsInvalidation(second, () => calls.push('second'))
  try {
    await expect.poll(() => calls).toEqual(['first'])
    await frames()
    expect(calls).toEqual(['first'])
  } finally {
    firstFace.dispose()
    secondFace.dispose()
    first.remove()
    second.remove()
  }
})
