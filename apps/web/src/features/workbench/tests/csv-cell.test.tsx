import { createEditorTextBuffer, createEditorViewSession } from '@singapore-editor/core/document'
import { fireEvent, screen } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { CsvCellInput } from '@/features/workbench/components/csv-cell'
import { csvCellEdit, parseCsv, type CsvCell } from '@/features/workbench/utils/csv'

test('cells activate, cancel without publication and commit through the live buffer before returning to text', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const buffer = createEditorTextBuffer('pear,1')
  const view = createEditorViewSession(buffer)
  const presentation = parseCsv(buffer.materializeFullText())
  expect(presentation.kind).toBe('table')
  if (presentation.kind !== 'table') return
  const { table } = presentation
  const edit = (cell: CsvCell, value: string) => {
    const replacement = csvCellEdit(cell, table.delimiter, value)
    if (replacement) buffer.applyEdits(view.getSelections(), [replacement], {}, view)
  }
  const rendered = renderWithProviders(
    <div role='table'>
      {table.rows[0]!.map((cell, column) => (
        <CsvCellInput
          key={column}
          cell={cell}
          row={0}
          column={column}
          editable
          width={96}
          onEdit={edit}
          active={column === 0}
          onSelect={() => {}}
          onNavigate={() => {}}
        />
      ))}
    </div>,
  )
  try {
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Row 1, column 1' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'cancelled' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(buffer.materializeFullText()).toBe('pear,1')
    expect(buffer.getRevision()).toBe(0)
    expect(screen.getByRole('button', { name: 'Row 1, column 1' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Row 1, column 1' }), { key: 'Enter' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'peach' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' })
    expect(buffer.materializeFullText()).toBe('peach,1')
    expect(buffer.getRevision()).toBe(1)
    buffer.undo(view)
    expect(buffer.materializeFullText()).toBe('pear,1')
  } finally {
    rendered.unmount()
  }
})
