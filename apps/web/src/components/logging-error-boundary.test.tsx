import '@testing-library/jest-dom/vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'

import { expect, test } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'

const { reports } = vi.hoisted(() => ({
  reports: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/client-error-reporting', () => ({
  reportClientError: (report: Record<string, unknown>) => {
    reports.push(report)
  },
}))

beforeEach(() => {
  reports.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('logs render errors and shows a recovery dialog', async () => {
  const { LoggingErrorBoundary } = await import('@/components/logging-error-boundary')
  const user = userEvent.setup()

  renderWithProviders(
    <LoggingErrorBoundary>
      <ThrowingChild />
    </LoggingErrorBoundary>,
  )

  expect(screen.getByRole('dialog', { name: 'Something went wrong' })).toBeInTheDocument()
  expect(screen.getByText('render blew up')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Stack trace' }))
  expect(screen.getByText(/Error stack/)).toBeInTheDocument()
  expect(screen.getByText(/React component stack/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reload app' })).toBeInTheDocument()
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({
    area: 'react',
    cause: expect.any(Error),
    context: {
      componentStack: expect.any(String),
      kind: 'boundary',
    },
    message: 'React render error caught by an error boundary.',
    operation: 'react.error_boundary',
  })
})

function ThrowingChild() {
  throwRenderError()

  return null
}

function throwRenderError() {
  throw new Error('render blew up')
}
