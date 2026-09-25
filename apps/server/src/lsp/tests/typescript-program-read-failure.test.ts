import { expect, test, vi } from 'vitest'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../fs/read', () => ({ readTextFile: read }))

import { readProgramFiles, type ProgramFileSystem } from '../typescript/program-files'

test('keeps unexpected file read errors in the batch failure list', async () => {
  read.mockRejectedValueOnce(new TypeError('unexpected decoder failure')).mockResolvedValueOnce({
    content: 'ok',
    size: 2,
    version: 'version',
    mtimeMs: 0,
  })
  const result = await readProgramFiles(
    { maxTextFileBytes: 1024 } as ProgramFileSystem,
    ['bad.ts', 'good.ts'],
    1024,
  )
  expect(result.failed).toEqual([{ path: 'bad.ts', code: 'OPERATION_FAILED' }])
  expect(result.files).toEqual([
    {
      path: 'good.ts',
      content: 'ok',
      size: 2,
      version: 'version',
      diskVersion: 'stat:0:2',
      dependencies: '[[],[],[],[],false]',
    },
  ])
})
