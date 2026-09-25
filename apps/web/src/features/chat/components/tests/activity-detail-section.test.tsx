import { screen, within } from '@testing-library/react'

import { ActivityDetailSection } from '@/features/chat/components/activity-detail-section'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

function renderSection(props: { failed?: boolean; label: string; value: string }) {
  return renderWithProviders(
    <TestEditorStateProvider>
      <ActivityDetailSection activityId='row' failed={props.failed ?? false} {...props} />
    </TestEditorStateProvider>,
  )
}

test('JSON input is pretty-printed', () => {
  renderSection({ label: 'Input', value: '{"path":"src/a.ts","limit":2}' })

  expect(screen.getByLabelText('Input').textContent).toBe(
    '{\n  "path": "src/a.ts",\n  "limit": 2\n}',
  )
})

test('failed output takes the destructive tint, and a stack frame becomes a link', () => {
  renderSection({
    failed: true,
    label: 'Output',
    value:
      'error: boom\n      at load (/work/app/src/config.ts:7:1)\n    at x (node:internal/a:1:2)',
  })
  const output = screen.getByLabelText('Output')

  expect(output).toHaveClass('bg-destructive/10', 'text-destructive')
  expect(within(output).getByRole('link', { name: '/work/app/src/config.ts:7:1' })).toHaveAttribute(
    'data-stack-frame',
    '/work/app/src/config.ts:7',
  )
  expect(within(output).queryByRole('link', { name: /node:internal/ })).not.toBeInTheDocument()
})

test('coloured output keeps its text without escape codes', () => {
  renderSection({ label: 'Output', value: '\u001b[32mpassed\u001b[39m 12 tests' })

  expect(screen.getByLabelText('Output').textContent).toBe('passed 12 tests')
})
