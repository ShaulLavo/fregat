import { afterEach, expect, it } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { createDocumentSession } from '../src/public/document'
import '../src/style.css'

type Restore = () => void

const restores: Restore[] = []

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

// Counts the reads that force style or layout while an editor that does not hold focus opens.
function countLayoutReads(): { readonly count: () => number; readonly stop: Restore } {
  let reads = 0
  const elementRect = Element.prototype.getBoundingClientRect
  const rangeRect = Range.prototype.getBoundingClientRect
  const rangeRects = Range.prototype.getClientRects
  const computedStyle = window.getComputedStyle
  Element.prototype.getBoundingClientRect = function (this: Element) {
    reads += 1
    return elementRect.call(this)
  }
  Range.prototype.getBoundingClientRect = function (this: Range) {
    reads += 1
    return rangeRect.call(this)
  }
  Range.prototype.getClientRects = function (this: Range) {
    reads += 1
    return rangeRects.call(this)
  }
  window.getComputedStyle = (element, pseudo) => {
    reads += 1
    return computedStyle.call(window, element, pseudo)
  }
  const stop = () => {
    Element.prototype.getBoundingClientRect = elementRect
    Range.prototype.getBoundingClientRect = rangeRect
    Range.prototype.getClientRects = rangeRects
    window.getComputedStyle = computedStyle
  }
  restores.push(stop)
  return { count: () => reads, stop }
}

function mountEditor() {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:400px;height:180px'
  document.body.append(host)
  const editor = new Editor(host)
  restores.push(() => {
    editor.dispose()
    host.remove()
  })
  return { editor, host }
}

const visibleCarets = (host: HTMLElement) =>
  host.querySelectorAll('.editor-virtualized-caret:not([hidden])')

const caretTransform = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('.editor-virtualized-caret')?.style.transform ?? ''

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

it('opens a document in an unfocused editor without reading layout, and draws the caret on focus', async () => {
  const { editor, host } = mountEditor()
  editor.setText('warm up')
  await nextFrame()
  const warmCaret = caretTransform(host)
  const session = createDocumentSession('const alpha = 1\nconst beta = 2\n')
  session.setSelection(6)

  const reads = countLayoutReads()
  editor.attachSession(session)
  const openReads = reads.count()
  reads.stop()

  expect(openReads).toBe(0)
  expect(caretTransform(host)).toBe(warmCaret)

  editor.focus()

  expect(visibleCarets(host)).toHaveLength(1)
  expect(caretTransform(host)).not.toBe(warmCaret)
})

it('draws an unfocused editor caret in the next frame', async () => {
  const { editor, host } = mountEditor()
  const session = createDocumentSession('alpha\nbeta\n')
  session.setSelection(2)
  editor.attachSession(session)

  await expect.poll(() => visibleCarets(host).length).toBe(1)
})
