import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { createLineGutterPlugin } from '../../gutters/src/lineGutter'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

const mounted: { editor: Editor; container: HTMLElement }[] = []

const TEXT = `${'wrapped words '.repeat(12)}\nsecond line`

const numbersIn = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>(
    '.editor-virtualized-gutter-row:not([hidden]) .editor-virtualized-line-number',
  ),
]

const paintsNumber = (element: HTMLElement) =>
  !['none', 'normal', '""'].includes(getComputedStyle(element, '::before').content)

const expectNumbers = (numbers: readonly HTMLElement[]) => {
  expect(numbers.filter(paintsNumber).map((number) => getComputedStyle(number).counterSet)).toEqual(
    ['editor-line 1', 'editor-line 2'],
  )
}

afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.dispose()
    container.remove()
  }
})

test.each([false, true])(
  'leaves continuation rows unnumbered with gutter background %s',
  async (gutterBackground) => {
    const container = document.createElement('div')
    container.style.cssText = 'display:flex;width:240px;height:400px'
    document.body.append(container)
    const editor = new Editor(container, {
      defaultText: TEXT,
      wordWrap: true,
      cursorLineHighlight: { gutterBackground },
      plugins: [createLineGutterPlugin()],
    })
    mounted.push({ editor, container })

    await expect.poll(() => numbersIn(container).length).toBeGreaterThan(2)
    const numbers = numbersIn(container)
    const continuations = numbers.filter((number) => number.hidden)
    expect(continuations.length).toBeGreaterThan(0)
    expectNumbers(numbers)
    for (const number of continuations) {
      expect(paintsNumber(number)).toBe(false)
      expect(number.getBoundingClientRect().width).toBe(numbers[0]!.getBoundingClientRect().width)
    }

    editor.setSelection(30, 30)
    await expect.poll(() => numbersIn(container).filter(paintsNumber).length).toBe(2)
    expectNumbers(numbersIn(container))

    editor.setWordWrap(false)
    await expect.poll(() => numbersIn(container).length).toBe(2)
    expectNumbers(numbersIn(container))
    expect(numbersIn(container).every((number) => !number.hidden)).toBe(true)

    editor.setWordWrap(true)
    await expect.poll(() => numbersIn(container).length).toBeGreaterThan(2)
    expectNumbers(numbersIn(container))
    await page.elementLocator(container).screenshot()
  },
)
