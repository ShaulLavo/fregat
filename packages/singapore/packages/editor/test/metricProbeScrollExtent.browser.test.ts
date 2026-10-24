import { afterEach, expect, it } from 'vitest'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

let editor: Editor | undefined
let host: HTMLElement | undefined

afterEach(() => {
  editor?.dispose()
  host?.remove()
})

it('keeps the retained font probe inside the native scroll extent', async () => {
  host = document.createElement('div')
  host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
  document.body.append(host)
  editor = new Editor(host, { lineHeight: 20, scrollPastEnd: false, wordWrap: false })
  editor.setText('line\n'.repeat(10_000) + 'tail')
  for (let index = 0; index < 3; index++)
    await new Promise((resolve) => requestAnimationFrame(resolve))

  const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
  const extent = host.querySelector<HTMLElement>('.editor-virtualized-extent')!
  const probe = host.querySelector<HTMLElement>('.editor-virtualized-metric-probe')!
  expect(probe).not.toBeNull()
  expect(Reflect.get(Element.prototype, 'scrollHeight', scroller)).toBe(
    extent.getBoundingClientRect().height,
  )
  expect(probe.getBoundingClientRect().top).toBe(scroller.getBoundingClientRect().top)
})
