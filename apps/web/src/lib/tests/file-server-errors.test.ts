import { vi } from 'vitest'

import { log } from '@/lib/client-logging'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile, statPath } from '@/lib/file-server'
import { expect, test } from '../../../test/fixtures'

test.for(['read', 'stat'] as const)(
  'a missing file %s logs its code and status at info level',
  async (operation, { client }) => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const request = operation === 'read' ? fetchFile : statPath
    try {
      await expect(
        request(filesystemPath('missing.txt'), new AbortController().signal, client),
      ).rejects.toThrow()
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: `fs.${operation}`,
          error: expect.objectContaining({ code: 'NOT_FOUND', status: 404 }),
          outcome: 'error',
        }),
      )
      expect(warn).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
      warn.mockRestore()
    }
  },
)
