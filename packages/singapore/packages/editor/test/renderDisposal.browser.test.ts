import { afterEach, expect, it, vi } from 'vitest'
import '../src/style.css'
import { Editor } from '../src/editor/Editor'

const releases: (() => void)[] = []

afterEach(() => {
  for (const release of releases.splice(0)) release()
  vi.restoreAllMocks()
})

async function frames(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

it.each(['content-height', 'gutter-width', 'gutter-create', 'gutter-update'])(
  'disposes the browser Editor from %s without resuming paint',
  async (site) => {
    const host = document.createElement('div')
    host.style.cssText = 'width:400px;height:200px;display:flex'
    document.body.appendChild(host)
    let editor: Editor
    let armed = false
    let entries = 0
    const updates = vi.fn()
    const disposed = vi.fn()
    const cells: HTMLElement[] = []
    const cleanup = new Map<HTMLElement, number>()
    const disposeAt = (current: string) => {
      if (!armed || current !== site) return
      armed = false
      entries += 1
      editor.dispose()
    }
    editor = new Editor(host, {
      plugins: [
        {
          activate(context) {
            const view = context.registerViewContribution({
              createContribution: () => ({
                inputs: ['viewport'],
                update: updates,
                dispose: disposed,
              }),
            })
            const gutter = context.registerGutterContribution({
              id: 'lifecycle',
              width: () => {
                disposeAt('gutter-width')
                return 20
              },
              createCell: (document) => {
                disposeAt('gutter-create')
                const cell = document.createElement('div')
                cells.push(cell)
                return cell
              },
              updateCell: () => disposeAt('gutter-update'),
              disposeCell: (cell) => cleanup.set(cell, (cleanup.get(cell) ?? 0) + 1),
            })
            return [view, gutter]
          },
        },
      ],
    })
    releases.push(() => {
      editor.dispose()
      host.remove()
    })
    editor.setText('old0\nold1')
    await frames()
    expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeGreaterThan(0)
    expect(editor.getContentHeight()).toBeGreaterThan(0)
    updates.mockClear()
    const errors = vi.spyOn(console, 'error')
    editor.onDidChangeContentHeight(() => disposeAt('content-height'))
    armed = true

    editor.setContent('new0\nnew1\nnew2\nnew3\nnew4\nnew5\nnew6\nnew7')
    await frames()

    expect(entries).toBe(1)
    expect(errors).not.toHaveBeenCalled()
    expect(host.querySelector('[data-editor-virtual-row]')).toBeNull()
    expect(host.querySelector('.editor-virtualized')).toBeNull()
    expect(updates).not.toHaveBeenCalled()
    expect(disposed).toHaveBeenCalledOnce()
    expect(cells.every((cell) => cleanup.get(cell) === 1)).toBe(true)
  },
)
