import { initLogger } from 'evlog'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))

vi.mock('sonner', () => ({
  toast: { error: toastError },
}))

initLogger({ _suppressDrainWarning: true, silent: true })

describe('notifyMutationError', () => {
  beforeEach(() => {
    toastError.mockReset()
  })

  it('toasts git RPC failures with the mapped client message', () => {
    notifyMutationError({
      value: { error: { code: 'GIT_COMMAND_FAILED' } },
    })

    expect(toastError).toHaveBeenCalledWith('Git command failed', {
      action: expect.objectContaining({ label: 'Fix with AI' }),
      description: 'The file server could not complete the filesystem operation.',
    })
  })

  it('does not toast unknown errors', () => {
    notifyMutationError(new Error('network closed'))

    expect(toastError).not.toHaveBeenCalled()
  })
})
