import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../src/style.css'

import { createLineGutterPlugin } from '../../gutters/src/index.ts'
import { Editor } from '../src/editor'
import { createDocumentSession } from '../src/public/document'
import { editorElement } from './editorElement'

/**
 * Auto-scroll only means anything against a real scrollport: what it compares are `scrollWidth`
 * and `clientWidth`, and the column a drag lands on comes back from a hit test. happy-dom reports
 * all of those as zero, so a sideways drag can only be proven here.
 */
describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'dragging past a viewport edge',
  () => {
    const LONG_LINE = 'const value = 42; '.repeat(60)
    let container: HTMLElement
    let editor: Editor

    beforeEach(async () => {
      container = document.createElement('div')
      container.style.display = 'flex'
      container.style.height = '120px'
      container.style.width = '240px'
      document.body.appendChild(container)
      editor = new Editor(container, { plugins: [createLineGutterPlugin()] })
      editor.attachSession(createDocumentSession(LONG_LINE))
      await expect
        .poll(() => editorElement(editor).querySelector('[data-editor-virtual-row]'))
        .not.toBeNull()
    })

    afterEach(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { cancelable: true }))
      editor.dispose()
      container.remove()
    })

    function press(clientX: number, clientY: number): void {
      editorElement(editor).dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          detail: 1,
        }),
      )
    }

    function drag(clientX: number, clientY: number): void {
      document.dispatchEvent(new MouseEvent('mousemove', { cancelable: true, clientX, clientY }))
    }

    it('scrolls right while the pointer is held past the right edge', () => {
      const el = editorElement(editor)
      const rect = el.getBoundingClientRect()
      expect(el.scrollWidth).toBeGreaterThan(el.clientWidth)

      press(rect.left + 60, rect.top + 5)
      drag(rect.right + 20, rect.top + 5)

      expect(el.scrollLeft).toBeGreaterThan(0)
      expect(el.scrollTop).toBe(0)
    })

    it('scrolls back left while the pointer is held over the gutter', () => {
      const el = editorElement(editor)
      const rect = el.getBoundingClientRect()

      press(rect.left + 60, rect.top + 5)
      drag(rect.right + 20, rect.top + 5)
      const scrolledRight = el.scrollLeft
      // Over the gutter, which is sticky: it hides the text behind it, so nothing else reaches it.
      drag(rect.left + 2, rect.top + 5)

      expect(scrolledRight).toBeGreaterThan(0)
      expect(el.scrollLeft).toBeLessThan(scrolledRight)
    })

    it('leaves the viewport alone while the pointer stays over text', () => {
      const el = editorElement(editor)
      const rect = el.getBoundingClientRect()

      press(rect.left + 60, rect.top + 5)
      drag(rect.left + 120, rect.top + 5)

      expect(el.scrollLeft).toBe(0)
      expect(el.scrollTop).toBe(0)
    })
  },
)
