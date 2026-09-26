import { vi } from 'vitest'

import { log } from '@/lib/client-logging'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { expect, test } from '../../../test/fixtures'

test('a failed read logs the error code and status', async ({ client }) => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})

  try {
    await expect(
      fetchFile(filesystemPath('missing.txt'), new AbortController().signal, client),
    ).rejects.toThrow()

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fs.read',
        error: expect.objectContaining({ code: 'NOT_FOUND', status: 404 }),
        outcome: 'error',
      }),
    )
  } finally {
    warn.mockRestore()
  }
})
