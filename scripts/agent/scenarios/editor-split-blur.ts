import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import type { Page } from 'playwright'
import { openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

type DragSnapshot = {
  opacity: string
  previewCount: number
  groups: number
}
type BlurEvent = { trusted: boolean; visibility: string }
type Inspection = { blur: readonly BlurEvent[]; stages: Record<string, DragSnapshot> }
const inspections = new WeakMap<Page, Inspection>()

export const editorSplitBlur: Scenario = {
  name: 'editor-split-blur',
  description:
    'Check pointer-sensor cancellation when the window blurs and pointerup happens in another document.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    const result: Inspection = { blur: [], stages: {} }
    inspections.set(page, result)
    await page.keyboard.down('Control')
    await startCopyDrag(page)
    await selectors.editorDropPreview(page).waitFor()
    result.stages.dragging = await dragSnapshot(page)
    await step('dragging-before-blur')
    result.blur = await blurIntoFrame(page)
    deepStrictEqual(result.blur, [{ trusted: true, visibility: 'visible' }])
    await selectors.editorDropPreview(page).waitFor({ state: 'hidden' })
    result.stages.blurred = await dragSnapshot(page)
    await step('blur-without-pointerup')

    const frameBounds = await selectors.editorBlurProbeFrame(page).boundingBox()
    ok(frameBounds)
    await page.mouse.move(frameBounds.x + 25, frameBounds.y + 25)
    await page.mouse.up()
    await selectors.editorBlurProbeFrame(page).evaluate((element) => element.remove())
    await page.keyboard.up('Control')
    result.stages.foreignPointerUp = await dragSnapshot(page)
    await step('released-outside-editor-document')

    await page.keyboard.down('Control')
    await startCopyDrag(page)
    await selectors.editorDropPreview(page).waitFor()
    result.stages.nextDrag = await dragSnapshot(page)
    await step('following-drag')
    await page.mouse.up()
    await page.keyboard.up('Control')
    await selectors.editorGroups(page).nth(1).waitFor()
    result.stages.afterNextDrop = await dragSnapshot(page)
    strictEqual(result.stages.dragging.opacity, '0.6')
    strictEqual(result.stages.blurred.opacity, '1', 'window blur released the internal drag sensor')
    strictEqual(result.stages.nextDrag.previewCount, 1, 'following drag can start immediately')
    strictEqual(result.stages.afterNextDrop.groups, 2, 'following drag completes its split')
    await step('following-drag-completed')

    await selectors.editorGroupTabs(page, 0).first().focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    result.stages.keyboardDragging = await dragSnapshot(page)
    strictEqual(result.stages.keyboardDragging.opacity, '0.6')
    await blurIntoFrame(page)
    await page.waitForTimeout(100)
    result.stages.keyboardBlurred = await dragSnapshot(page)
    strictEqual(result.stages.keyboardBlurred.opacity, '1', 'blur also cancels the keyboard sensor')
    await selectors.editorBlurProbeFrame(page).evaluate((element) => element.remove())
    await step('keyboard-blur-cancelled')
  },
  async inspect(page) {
    return inspections.get(page)
  },
}

async function startCopyDrag(page: Page) {
  const tab = await selectors.editorGroupTabs(page, 0).first().boundingBox()
  const body = await selectors.editorGroupContent(page, 0).boundingBox()
  ok(tab && body)
  await page.mouse.move(tab.x + 30, tab.y + tab.height / 2)
  await page.mouse.down()
  await page.mouse.move(tab.x + 45, tab.y + 45, { steps: 4 })
  await page.mouse.move(body.x + body.width - 12, body.y + body.height / 2, { steps: 12 })
  await page.waitForTimeout(150)
}

async function dragSnapshot(page: Page): Promise<DragSnapshot> {
  const tab = selectors.editorGroupTabs(page, 0).first()
  return {
    opacity: await tab.evaluate((element) => getComputedStyle(element).opacity),
    previewCount: await selectors.editorDropPreview(page).count(),
    groups: await selectors.editorGroups(page).count(),
  }
}

async function blurIntoFrame(page: Page): Promise<readonly BlurEvent[]> {
  return page.evaluate(async () => {
    const events: BlurEvent[] = []
    window.addEventListener(
      'blur',
      (event) => {
        events.push({ trusted: event.isTrusted, visibility: document.visibilityState })
      },
      { once: true },
    )
    const frame = document.createElement('iframe')
    frame.dataset.editorBlurProbe = ''
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '50px',
      height: '50px',
      zIndex: '9999',
    })
    document.body.append(frame)
    await new Promise((resolve) => setTimeout(resolve, 50))
    frame.contentWindow?.focus()
    return events
  })
}
