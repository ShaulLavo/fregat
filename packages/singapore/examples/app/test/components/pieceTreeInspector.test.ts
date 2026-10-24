import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
} from '@singapore-editor/core/document'
import { getPieceTreeSnapshot } from '@singapore-editor/core/debug'
import {
  createDocumentTextSnapshot,
  createStringTextSnapshot,
} from '@singapore-editor/core/document'
import { openPieceTreeInspector } from '../../src/components/pieceTreeInspector.ts'

afterEach(() => document.body.replaceChildren())

describe('piece tree inspector', () => {
  it('reads the built snapshot bridge without materializing text', () => {
    const snapshot = createPieceTableSnapshot('private')
    const text = createDocumentTextSnapshot(snapshot)
    expect(getPieceTreeSnapshot(text)).toBe(snapshot)
    expect(getPieceTreeSnapshot(createStringTextSnapshot('plain'))).toBeNull()
  })

  it('bounds large tree rows, collapses, selects, looks up reverse entries and compares captures', async () => {
    let snapshot = createPieceTableSnapshot('row\n'.repeat(1000000))
    for (let i = 0; i < 600; i++) snapshot = insertIntoPieceTable(snapshot, i * 100, 'x')
    const dialog = openPieceTreeInspector(() => snapshot)
    const select = dialog.querySelector<HTMLSelectElement>('select[aria-label="Inspection nodes"]')!
    expect(select.length).toBe(200)
    expect(dialog.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(dialog.querySelector('textarea')?.value).not.toContain('text=')
    const total = snapshot.root!.subtreeOriginalLength
    let reads = 0
    Object.defineProperty(snapshot.root!, 'subtreeOriginalLength', {
      get: () => {
        reads++
        return total
      },
      configurable: true,
    })
    await page.getByRole('button', { name: 'Collapse selected', exact: true }).click()
    expect(reads).toBe(0)
    expect(select.length).toBe(1)
    await page.getByRole('button', { name: 'Expand selected', exact: true }).click()
    expect(select.length).toBe(200)
    // An inserted piece: original text has no entry in the reverse index.
    const inserted = Array.from(select.options).find((option) => / 1:\d+ /.test(option.text))!
    await page.getByRole('listbox', { name: 'Inspection nodes' }).selectOptions(inserted.value)
    const id = select.value
    expect(dialog.querySelector('textarea')?.value).toContain(id)
    await page.getByRole('button', { name: 'Find in other tree' }).click()
    expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="Tree"]')?.value).toBe(
      'reverse',
    )
    expect(dialog.querySelector('textarea')?.value).toContain('reverse')
    snapshot = deleteFromPieceTable(snapshot, 0, 1000)
    await page.getByRole('button', { name: 'Capture after', exact: true }).click()
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain('0 issues')
    expect(dialog.querySelector('textarea')?.value).toMatch(/reused|copied|added/)
    await page.getByRole('checkbox', { name: 'Show text excerpts' }).click()
    expect(dialog.querySelector('textarea')?.value).toContain('text=')
    await page.getByRole('button', { name: 'Close inspector' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })
})
