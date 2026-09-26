import { filesystemPath } from '@/lib/documents/utils/identity'
import {
  containerContentsLoaded,
  containerTreePath,
  duplicateTreePath,
  entryName,
  newEntryTreePath,
  workspacePathForTreePath,
} from '@/features/workspace/utils/entry-paths'
import { expect, test } from '../../../../../test/fixtures'

test('joins the pane root with a tree path', () => {
  expect(workspacePathForTreePath(filesystemPath('repo'), 'src/a.ts')).toBe('repo/src/a.ts')
})

test('tolerates trailing slashes on either half', () => {
  expect(workspacePathForTreePath(filesystemPath('repo/'), 'src/lib/')).toBe('repo/src/lib')
})

test('a rootless pane keeps the tree path as-is', () => {
  expect(workspacePathForTreePath(filesystemPath(''), 'src/a.ts')).toBe('src/a.ts')
})

test('the pane root itself resolves to the root path', () => {
  expect(workspacePathForTreePath(filesystemPath('repo'), '')).toBe('repo')
})

test('a directory row hosts new entries inside itself', () => {
  expect(containerTreePath('src/lib/', true)).toBe('src/lib')
})

test('a file row hosts new entries beside itself', () => {
  expect(containerTreePath('src/lib/a.ts', false)).toBe('src/lib')
})

test('a top-level file row hosts new entries at the pane root', () => {
  expect(containerTreePath('a.ts', false)).toBe('')
})

test('a directory path with a trailing slash groups under its parent', () => {
  expect(containerTreePath('src/lib/', false)).toBe('src')
})

test('a new file placeholder lands inside the container', () => {
  expect(
    newEntryTreePath({ containerPath: 'src', existingPaths: new Set(), isFolder: false }),
  ).toBe('src/untitled')
})

test('a new folder placeholder keeps the trailing slash the tree needs', () => {
  expect(newEntryTreePath({ containerPath: 'src', existingPaths: new Set(), isFolder: true })).toBe(
    'src/new folder/',
  )
})

test('placeholders step past names already taken', () => {
  const existingPaths = new Set(['src/untitled', 'src/untitled 2'])

  expect(newEntryTreePath({ containerPath: 'src', existingPaths, isFolder: false })).toBe(
    'src/untitled 3',
  )
})

test('a duplicate keeps the extension and suffixes the stem', () => {
  expect(
    duplicateTreePath({ existingPaths: new Set(), isDirectory: false, treePath: 'src/a.ts' }),
  ).toBe('src/a copy.ts')
})

test('duplicating a duplicate counts up', () => {
  const existingPaths = new Set(['src/a.ts', 'src/a copy.ts'])

  expect(duplicateTreePath({ existingPaths, isDirectory: false, treePath: 'src/a.ts' })).toBe(
    'src/a copy 2.ts',
  )
})

test('a dotfile has no extension to preserve', () => {
  expect(
    duplicateTreePath({ existingPaths: new Set(), isDirectory: false, treePath: '.gitignore' }),
  ).toBe('.gitignore copy')
})

test('a directory name is never split on its dots', () => {
  expect(
    duplicateTreePath({ existingPaths: new Set(), isDirectory: true, treePath: 'src/my.lib/' }),
  ).toBe('src/my.lib copy')
})

test('the pane root never has to wait for a load', () => {
  expect(containerContentsLoaded(new Set(), '')).toBe(true)
})

test('a directory whose children have landed is ready', () => {
  expect(containerContentsLoaded(new Set(['src']), 'src')).toBe(true)
  expect(containerContentsLoaded(new Set(['src']), 'src/')).toBe(true)
})

test('a directory still loading is not', () => {
  expect(containerContentsLoaded(new Set(['src']), 'docs')).toBe(false)
})

test('names come from the last segment, slash or not', () => {
  expect(entryName('src/lib/a.ts')).toBe('a.ts')
  expect(entryName('src/lib/')).toBe('lib')
  expect(entryName('a.ts')).toBe('a.ts')
})

test('an empty path has no name, and doubled slashes collapse', () => {
  expect(entryName('')).toBe('')
  expect(entryName('src//lib//')).toBe('lib')
})
