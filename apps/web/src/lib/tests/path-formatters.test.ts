import { describe, expect, test } from 'vitest'

import { parentPath as filePickerParentPath } from '@/features/file-picker/model'
import { parentPath } from '@/lib/path-formatters'

describe('parentPath', () => {
  test('is empty for a file at the repository root', () => {
    expect(parentPath('README.md')).toBe('')
  })

  test('returns the directory one level deep', () => {
    expect(parentPath('src/index.ts')).toBe('src')
  })

  test('keeps a leading slash on an absolute path', () => {
    expect(parentPath('/a/b')).toBe('/a')
    expect(parentPath('/a')).toBe('')
  })

  test('diverges from the file-picker variant, which is not a copy', () => {
    expect(parentPath('/a/b')).toBe('/a')
    expect(filePickerParentPath('/a/b')).toBe('a')
    expect(parentPath('a//b')).toBe('a/')
    expect(filePickerParentPath('a//b')).toBe('a')
  })
})
