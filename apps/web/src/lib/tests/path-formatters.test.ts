import { describe } from 'vitest'
import { expect, test } from '../../../test/fixtures'

import { pickerParentPath as filePickerParentPath } from '@/features/file-picker/utils/model'
import {
  basename,
  lastPathSegment,
  parentPath,
  parentFilesystemPath,
  pathLeaf,
} from '@/lib/path-formatters'
import { filesystemPath } from '@/lib/documents/utils/identity'

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

test('filesystem event parents clamp the watched root and bare paths', () => {
  expect(parentPath('/repo', '/repo')).toBe('/repo')
  expect(parentPath('README.md', '/repo')).toBe('/repo')
  expect(parentPath('/repo/src/index.ts', '/repo')).toBe('/repo/src')
  expect(parentFilesystemPath(filesystemPath('/repo'), filesystemPath('/repo'))).toBe('/repo')
  expect(parentFilesystemPath(filesystemPath('README.md'), filesystemPath('/repo'))).toBe('/repo')
})

test('conflict folder creation preserves an empty parent for a bare file', () => {
  expect(parentFilesystemPath(filesystemPath('README.md'))).toBe('')
  expect(parentFilesystemPath(filesystemPath('/repo/src/index.ts'))).toBe('/repo/src')
})

test('picker navigation preserves its root-relative separator normalization', () => {
  expect(filePickerParentPath('/a//b/')).toBe('a')
  expect(filePickerParentPath('/')).toBe('')
  expect(filePickerParentPath('README.md')).toBe('')
})

test('the three leaf helpers answer an empty and a trailing-slash path differently', () => {
  expect(['', 'a/', '/'].map(basename)).toEqual(['Root', 'a', 'Root'])
  expect(['', 'a/', '/'].map(pathLeaf)).toEqual(['', '', ''])
  expect(['', 'a/', '/'].map(lastPathSegment)).toEqual(['', 'a', '/'])
})
