import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, vi } from 'vitest'

import { CopyButton } from '@/components/copy-button'
import { log } from '@/lib/client-logging'
import { stubClipboard, type ClipboardStub } from '../../../test/factories/clipboard'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'

let clipboard: ClipboardStub
let user: ReturnType<typeof userEvent.setup>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // user-event installs its own clipboard on setup; ours goes on top of it.
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  clipboard = stubClipboard()
  vi.spyOn(toast, 'success').mockImplementation(() => 'toast')
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
})

afterEach(() => {
  clipboard.restore()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('a copy shows a check instead of a toast, then settles back', async () => {
  renderWithProviders(<CopyButton label='code' text='const a = 1' />)

  await user.click(screen.getByRole('button', { name: 'Copy code' }))

  expect(await screen.findByRole('button', { name: 'Copied code' })).toBeInTheDocument()
  expect(clipboard.written).toEqual([{ method: 'writeText', text: 'const a = 1' }])
  expect(toast.success).not.toHaveBeenCalled()

  act(() => vi.advanceTimersByTime(1200))
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
})

test('copying again restarts the confirmation', async () => {
  renderWithProviders(<CopyButton label='code' text='const a = 1' />)

  await user.click(screen.getByRole('button', { name: 'Copy code' }))
  await screen.findByRole('button', { name: 'Copied code' })
  act(() => vi.advanceTimersByTime(1000))
  await user.click(screen.getByRole('button', { name: 'Copied code' }))
  await vi.waitFor(() => expect(clipboard.written).toHaveLength(2))
  act(() => vi.advanceTimersByTime(1000))

  expect(screen.getByRole('button', { name: 'Copied code' })).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(200))
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
})

test('unmounting mid-confirmation leaves no timer running', async () => {
  const view = renderWithProviders(<CopyButton label='code' text='const a = 1' />)

  await user.click(screen.getByRole('button', { name: 'Copy code' }))
  await screen.findByRole('button', { name: 'Copied code' })
  const running = vi.getTimerCount()
  view.unmount()

  expect(vi.getTimerCount()).toBeLessThan(running)
})

test('a refused copy never claims success and reports once', async () => {
  vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  clipboard.refuse('writeText')
  clipboard.refuse('write')
  clipboard.refuse('execCommand')
  renderWithProviders(<CopyButton label='code' text='const a = 1' />)

  await user.click(screen.getByRole('button', { name: 'Copy code' }))

  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
  expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe('Could not copy code')
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
  expect(toast.success).not.toHaveBeenCalled()
})
