import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ComposerActivePlan } from '@/features/chat/components/composer-active-plan'
import type { ChatWorkLogPlan } from '@/features/chat/utils/work-log'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const running: ChatWorkLogPlan = {
  completedCount: 1,
  currentStep: 'Run the tests',
  liveCount: 2,
  steps: [
    { status: 'completed', step: 'Patch the gutter' },
    { status: 'dropped', step: 'Write a migration' },
    { status: 'inProgress', step: 'Run the tests' },
  ],
}
const done: ChatWorkLogPlan = {
  ...running,
  completedCount: 2,
  currentStep: null,
  steps: running.steps.map((step) =>
    step.status === 'inProgress' ? { ...step, status: 'completed' } : step,
  ),
}

test('counts live steps, strikes the dropped one, and folds itself when done', async () => {
  const { rerender } = renderWithProviders(<ComposerActivePlan plan={running} />)
  expect(screen.getByLabelText('Plan progress')).toHaveTextContent('1/2')

  await userEvent.click(screen.getByRole('button', { name: /Run the tests/ }))
  expect(screen.getByText('Write a migration')).toHaveClass('line-through')
  expect(screen.getByLabelText('Dropped')).toBeInTheDocument()

  rerender(<ComposerActivePlan plan={done} />)
  expect(screen.getByRole('button', { name: /Plan complete/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  )

  rerender(<ComposerActivePlan plan={running} />)
  expect(screen.getByRole('button', { name: /Run the tests/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})
