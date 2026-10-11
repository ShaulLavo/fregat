import '@singapore-editor/core/style.css'
import { Editor } from '@singapore-editor/core/editor'

const text = 'alpha bravo charlie\nsecond line\nthird row'
const modes = ['native', 'absolute', 'window', 'editor'] as const
const requested = new URL(location.href).searchParams.get('mode')
const mode = modes.find((value) => value === requested) ?? 'native'
const host = document.querySelector<HTMLElement>('#host')!
let editor: Editor | undefined

if (mode === 'editor') {
  editor = new Editor(host, { fontSize: 20, lineHeight: 24 })
  editor.setText(text)
} else {
  const native = document.createElement('div')
  native.className = 'native'
  host.append(native)
  if (mode === 'native') {
    native.contentEditable = 'true'
    native.textContent = text
  } else {
    const window = document.createElement('div')
    window.style.cssText = 'position:absolute;left:0;top:0;width:100%'
    native.append(window)
    for (const [index, line] of text.split('\n').entries()) {
      const row = document.createElement('div')
      row.dataset.row = String(index)
      row.textContent = line
      row.style.cssText = 'height:24px;line-height:24px;white-space:pre'
      if (mode === 'absolute') {
        row.style.position = 'absolute'
        row.style.inset = '0 0 auto'
        row.style.transform = `translateY(${index * 24}px)`
        row.style.contain = 'layout paint style size'
        row.style.willChange = 'transform'
      }
      window.append(row)
    }
  }
}

for (const name of modes) {
  const link = document.createElement('a')
  link.textContent = name
  const url = new URL(location.href)
  url.searchParams.set('mode', name)
  url.searchParams.set('nonce', crypto.randomUUID())
  link.href = url.href
  document.querySelector('nav')!.append(link, document.createTextNode(' '))
}

function record(event: Pick<Event, 'type'>): void {
  const selection = document.getSelection()
  const row = selection?.focusNode?.parentElement?.closest<HTMLElement>(
    '[data-editor-virtual-row],[data-row]',
  )
  const state = {
    mode,
    type: event.type,
    text: selection?.toString(),
    anchor: selection?.anchorOffset,
    focus: selection?.focusOffset,
    focusRow: row?.dataset.editorVirtualRow ?? row?.dataset.row,
    session: editor?.getSelections().map((range) => [range.anchorOffset, range.headOffset]),
    rows: Array.from(document.querySelectorAll<HTMLElement>('.editor-virtualized-row'), (row) => ({
      text: row.textContent,
      y: row.getBoundingClientRect().top,
      position: getComputedStyle(row).position,
    })),
  }
  document.querySelector('#selection')!.textContent = `Selected: ${state.text}`
  document.querySelector('#state')!.textContent = `State: ${JSON.stringify(state)}`
}
for (const type of ['selectionchange', 'touchstart', 'touchend']) {
  document.addEventListener(type, record)
}
record({ type: 'ready' })
