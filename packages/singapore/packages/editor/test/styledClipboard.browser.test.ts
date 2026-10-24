import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { createDocumentSession } from '../src/public/document'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofClipboardPermissions(): Promise<void>
  }
}

it('copies ordered styled fragments with trusted keys into rich and plain receivers', async () => {
  await commands.proofClipboardPermissions()
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:140px'
  const rich = document.createElement('div')
  rich.contentEditable = 'true'
  rich.style.cssText = 'height:60px;background:white;color:black'
  const plain = document.createElement('textarea')
  document.body.append(host, rich, plain)
  const session = createDocumentSession('const x = 1\nother & text')
  const editor = new Editor(host)
  editor.attachSession(session)
  session.setSelections([
    { anchor: 0, head: 5 },
    { anchor: 12, head: 24 },
  ])
  editor.setTokens([{ start: 0, end: 5, style: { color: '#123456' } }])
  try {
    editor.focus()
    await commands.proofKeyPress('Control+c')
    rich.focus()
    await commands.proofKeyPress('Control+v')
    expect(rich.textContent).toBe('const\nother & text')
    const styled = [...rich.querySelectorAll('span')].find((node) => node.textContent === 'const')
    expect(styled).toBeDefined()
    expect(getComputedStyle(styled!).color).toBe('rgb(18, 52, 86)')
    plain.focus()
    await commands.proofKeyPress('Control+v')
    expect(plain.value).toBe('const\nother & text')
  } finally {
    editor.dispose()
    host.remove()
    rich.remove()
    plain.remove()
  }
})
