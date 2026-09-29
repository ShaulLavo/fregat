import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import '../src/style.css'

import { createFoldGutterPlugin, createLineGutterPlugin } from '../../gutters/src/index.ts'
import { Editor } from '../src/editor'
import { createMergeConflictPlugin } from '../src/mergeConflictPlugin'
import type { EditorGutterContribution, EditorPlugin } from '../src/plugins'
import { createDocumentSession } from '../src/public/document'
import { editorElement } from './editorElement'

const TEXT = ['alpha {', '  beta', '  gamma', '}', 'delta', 'epsilon'].join('\n')

type Probe = { readonly plugin: EditorPlugin; readonly presses: string[] }

/**
 * Whether a gutter cell takes a press is a hit test, which only a real engine runs: every click
 * here is a Playwright mouse click at the element's centre, so the target is whatever paints there.
 */
describe('gutter pointer events', () => {
  let container: HTMLElement
  let editor: Editor
  let interactive: Probe
  let inert: Probe

  beforeEach(async () => {
    container = document.createElement('div')
    container.style.display = 'flex'
    container.style.height = '240px'
    container.style.width = '360px'
    document.body.appendChild(container)
    interactive = createProbe('probe-interactive', true)
    inert = createProbe('probe-inert', false)
    editor = new Editor(container, {
      plugins: [
        createLineGutterPlugin(),
        createFoldGutterPlugin(),
        interactive.plugin,
        inert.plugin,
        createMergeConflictPlugin(),
      ],
    })
    editor.attachSession(createDocumentSession(TEXT))
    await expect.poll(() => foldToggle('expanded')).not.toBeNull()
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('hands a press on an interactive cell to the cell', async () => {
    const caret = editor.getState().cursor
    await click(cell('probe-interactive', 2))

    expect(interactive.presses).toEqual(['2'])
    expect(editor.getState().cursor).toEqual(caret)
  })

  it('passes a press on any other cell to the text beneath', async () => {
    await click(cell('probe-inert', 4))
    expect(inert.presses).toEqual([])
    expect(editor.getState().cursor.row).toBe(4)

    await click(cell('line-gutter', 1))
    expect(editor.getState().cursor.row).toBe(1)
  })

  it('places the caret from a press the interactive cell leaves unclaimed', async () => {
    await click(cell('fold-gutter', 4))

    expect(editor.getState().cursor.row).toBe(4)
  })

  it('folds and unfolds from the chevron', async () => {
    const caret = editor.getState().cursor
    await click(foldToggle('expanded')!)
    await expect.poll(() => visibleLines()).not.toContain('  beta')
    expect(visibleLines()).toContain('delta')

    await click(foldToggle('collapsed')!)
    await expect.poll(() => visibleLines()).toEqual(TEXT.split('\n'))
    expect(editor.getState().cursor).toEqual(caret)
  })

  it('keeps a retired gutter row out of layout', async () => {
    await click(foldToggle('expanded')!)
    await expect.poll(() => retiredGutterRows().length).toBeGreaterThan(0)

    expect(retiredGutterRows().filter((row) => row.getClientRects().length > 0)).toEqual([])
  })

  it('resolves a merge conflict from its lens', async () => {
    editor.setText(['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch'].join('\n'))
    const action = await lensAction('Accept Incoming Change')

    await click(action)

    expect(editor.materializeFullText()).toBe('theirs\n')
  })

  function cell(contribution: string, displayRow: number): HTMLElement {
    const row = container.querySelector(`[data-editor-virtual-gutter-row="${displayRow}"]`)
    const found = row?.querySelector<HTMLElement>(
      `[data-editor-gutter-contribution="${contribution}"]`,
    )
    if (!found) throw new TypeError(`No ${contribution} cell on row ${displayRow}`)
    return found
  }

  function foldToggle(state: 'expanded' | 'collapsed'): HTMLElement | null {
    return container.querySelector<HTMLElement>(
      `.editor-virtualized-fold-toggle[data-editor-fold-state="${state}"]`,
    )
  }

  function retiredGutterRows(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('.editor-virtualized-gutter-row[hidden]')]
  }

  function visibleLines(): string[] {
    return [...editorElement(editor).querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
      .filter((row) => !row.hidden)
      .sort(
        (left, right) =>
          Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
      )
      .map((row) => row.textContent ?? '')
  }

  async function lensAction(label: string): Promise<HTMLElement> {
    await expect
      .poll(() => container.querySelectorAll('.editor-merge-conflict-lens-action').length)
      .toBeGreaterThan(0)
    const actions = container.querySelectorAll<HTMLElement>('.editor-merge-conflict-lens-action')
    const action = [...actions].find((candidate) => candidate.textContent === label)
    if (!action) throw new TypeError(`No lens action ${label}`)
    return action
  }
})

async function click(element: Element): Promise<void> {
  // `force` skips Playwright's own hit check, so the press lands on whatever paints at the point.
  await userEvent.click(element, { force: true })
}

function createProbe(id: string, interactive: boolean): Probe {
  const presses: string[] = []
  const contribution: EditorGutterContribution = {
    id,
    interactive,
    createCell(document) {
      const cell = document.createElement('span')
      cell.addEventListener('mousedown', (event) => {
        event.preventDefault()
        presses.push(cell.dataset.row ?? '')
      })
      return cell
    },
    width: () => 12,
    updateCell(element, row) {
      element.dataset.row = String(row.bufferRow)
    },
  }
  return {
    presses,
    plugin: { name: id, activate: (context) => context.registerGutterContribution(contribution) },
  }
}
