import { screen } from '@testing-library/react'

import { TerminalContextChip } from '@/features/chat/components/terminal-context-chip'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const failure: TerminalContextSelection = {
  lineEnd: 814,
  lineStart: 812,
  source: 'terminal-1',
  text: 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1\nnpm ERR! build failed',
}

test('the chip names the terminal the output came from', () => {
  renderWithProviders(<TerminalContextChip selection={failure} />)

  expect(screen.getByText('terminal-1')).toBeVisible()
  expect(screen.getByText('lines 812-814')).toBeVisible()
})

test('a single-line capture reads singular', () => {
  renderWithProviders(
    <TerminalContextChip selection={{ ...failure, lineEnd: 812, text: 'make: *** [build]' }} />,
  )

  expect(screen.getByText('line 812')).toBeVisible()
})

test('the preview is the first line, truncated, never the whole capture', () => {
  renderWithProviders(<TerminalContextChip selection={failure} />)

  expect(screen.getByText('npm ERR! code ELIFECYCLE…')).toBeVisible()
  expect(screen.queryByText(/build failed/)).toBeNull()
})

test('a wall of output stays one chip-sized line', () => {
  renderWithProviders(<TerminalContextChip selection={{ ...failure, text: 'E'.repeat(400) }} />)

  expect(screen.getByText(`${'E'.repeat(80)}…`)).toBeVisible()
})

test('the full capture is still reachable from the chip', () => {
  renderWithProviders(<TerminalContextChip selection={failure} />)

  // Read off the attribute rather than through `getByTitle`, which collapses the
  // newlines that are the point of hovering a multi-line capture.
  const chip = screen.getByText('terminal-1').closest('[data-terminal-context-source]')

  expect(chip?.getAttribute('title')).toBe(failure.text)
})
