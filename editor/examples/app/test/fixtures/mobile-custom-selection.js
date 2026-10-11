import { Editor } from '../../../../packages/editor/src/editor.ts'
import { createTouchSelectionPlugin } from '../../../../packages/plugin-ui/src/touchSelectionPlugin.ts'
const shortText = 'alpha bravo charlie\nsecond line\nthird row'
const host = document.querySelector('#host')
const touchPlugin = createTouchSelectionPlugin({
  haptics: true,
  items: ({ selectedText }) => [
    {
      id: 'inspect',
      label: 'Demo: count characters',
      run() {
        document.querySelector('#status').textContent =
          `Action extension received ${selectedText.length} characters.`
      },
    },
  ],
})
window.touchMenuPlugin = touchPlugin
const editor = new Editor(host, {
  fontSize: 20,
  lineHeight: 24,
  plugins: [touchPlugin],
  onChange: () => record(),
})
window.touchEditor = editor
function record() {
  const selection = editor.getSelections()[0]
  const start = Math.min(selection?.anchorOffset ?? 0, selection?.headOffset ?? 0)
  const end = Math.max(selection?.anchorOffset ?? 0, selection?.headOffset ?? 0)
  const value = editor.materializeFullText().slice(start, end)
  document.querySelector('#selection').textContent = `Selected: ${value}`
  document.querySelector('#state').textContent =
    `State: ${JSON.stringify({ session: [start, end], dom: document.getSelection()?.toString(), scrollTop: editor.getScrollPosition().top })}`
  window.customTouchState = { start, end, value, scrollTop: editor.getScrollPosition().top }
}
editor.setText(shortText)
editor.setSelection(0)
editor.onDidScroll(record)
document.querySelector('#wrap').onchange = (event) => {
  editor.setWordWrap(event.target.checked)
  record()
}
document.querySelector('#long').onclick = () => {
  editor.setText(
    shortText +
      '\n' +
      Array.from(
        { length: 80 },
        (_, i) => `row ${i + 4}: alpha bravo charlie delta echo foxtrot golf hotel`,
      ).join('\n'),
  )
  editor.setSelection(0)
  record()
}
document.querySelector('#reset').onclick = () => {
  editor.setText(shortText)
  editor.setSelection(0)
  record()
}
record()

const gestureEvents = []
let nativeRowSelections = 0
let nativeRowSelectionActive = false
document.addEventListener('selectionchange', () => {
  const selection = document.getSelection()
  const node = selection?.anchorNode
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  const active = !selection?.isCollapsed && !!element?.closest('.editor-virtualized-row')
  if (active && !nativeRowSelectionActive) nativeRowSelections++
  nativeRowSelectionActive = active
  document.querySelector('#native-state').textContent =
    `Native row selections: ${nativeRowSelections}`
})
for (const type of ['touchstart', 'touchend', 'touchcancel']) {
  document.addEventListener(
    type,
    (event) => {
      const touch = event.changedTouches?.[0]
      gestureEvents.push({ type, x: touch?.clientX, y: touch?.clientY })
      document.querySelector('#events').textContent =
        `Events: ${JSON.stringify(gestureEvents.slice(-4))}`
    },
    { capture: true },
  )
}
