import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import { fileLoadState } from '@/features/workspace/hooks/use-selected-file'
import type { FileResult } from '@/lib/file-system-types'

describe('fileLoadState', () => {
  test('reports a pending file read as loading', () => {
    expect(
      fileLoadState({ data: undefined, error: null, isError: false, isPending: true }, 'repo/a.ts'),
    ).toEqual({ status: 'loading' })
  })

  test('does not enter a loading state for placeholder data from another path', () => {
    const state = fileLoadState(
      {
        data: file('repo/a.ts'),
        error: null,
        isError: false,
        isPending: false,
      },
      'repo/b.ts',
    )

    expect(state).toEqual({ status: 'idle' })
  })

  test('returns ready when the loaded file matches the selected path', () => {
    const loadedFile = file('repo/a.ts')
    const state = fileLoadState(
      {
        data: loadedFile,
        error: null,
        isError: false,
        isPending: false,
      },
      'repo/a.ts',
    )

    expect(state).toEqual({ status: 'ready', data: loadedFile })
  })
})

function file(path: string): FileResult {
  return {
    content: '',
    mtimeMs: 1,
    path,
    size: 1,
    version: 'test:1:1',
  }
}
