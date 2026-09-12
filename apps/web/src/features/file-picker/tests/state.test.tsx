import { filesystemPath } from '@/lib/documents/utils/identity'
import { act, renderHook } from '@testing-library/react'

import { expect, test } from '../../../../test/fixtures'
import { useFilePickerSession } from '@/features/file-picker/state'
import type { FsEntry, ServerInfo } from '@/lib/file-system-types'

test('moves backward and forward through visited paths', () => {
  const { result } = renderHook(() => useFilePickerSession(null))

  expect(result.current.isInitialized).toBe(false)

  act(() => result.current.initializeOpenSession(serverInfo('home')))
  act(() => result.current.navigateTo('home/projects'))
  act(() => result.current.navigateTo('home/projects/platform'))
  act(() => result.current.goBack())

  expect(result.current.isInitialized).toBe(true)
  expect(result.current.currentPath).toBe('home/projects')
  expect(result.current.backPath).toBe('home')
  expect(result.current.forwardPath).toBe('home/projects/platform')
  expect(result.current.canGoBack).toBe(true)
  expect(result.current.canGoForward).toBe(true)

  act(() => result.current.goBack())
  act(() => result.current.goForward())

  expect(result.current.currentPath).toBe('home/projects')
  expect(result.current.backPath).toBe('home')
  expect(result.current.forwardPath).toBe('home/projects/platform')
  expect(result.current.canGoBack).toBe(true)
  expect(result.current.canGoForward).toBe(true)

  act(() => result.current.goForward())

  expect(result.current.currentPath).toBe('home/projects/platform')
  expect(result.current.backPath).toBe('home/projects')
  expect(result.current.forwardPath).toBeNull()
  expect(result.current.canGoForward).toBe(false)
})

test('new navigation clears forward history', () => {
  const { result } = renderHook(() => useFilePickerSession(null))

  act(() => result.current.initializeOpenSession(serverInfo('home')))
  act(() => result.current.navigateTo('home/projects'))
  act(() => result.current.navigateTo('home/projects/platform'))
  act(() => result.current.goBack())
  act(() => result.current.jumpTo('tmp'))

  expect(result.current.currentPath).toBe('tmp')
  expect(result.current.forwardPath).toBeNull()
  expect(result.current.canGoForward).toBe(false)

  act(() => result.current.goForward())

  expect(result.current.currentPath).toBe('tmp')
})

test('fully resets state before reinitializing the next open session', () => {
  const { result } = renderHook(() => useFilePickerSession(null))
  const selected = entry('first-home/projects/readme.md', 'file')

  act(() => result.current.initializeOpenSession(serverInfo('first-home')))
  act(() => result.current.navigateTo('first-home/projects'))
  act(() => result.current.goBack())
  act(() => result.current.setQuery('readme'))
  act(() => result.current.setSelectedEntry(selected))

  expect(result.current.isInitialized).toBe(true)
  expect(result.current.canGoForward).toBe(true)

  act(() => result.current.resetOpenSession())

  expect(result.current.isInitialized).toBe(false)
  expect(result.current.currentPath).toBe('')
  expect(result.current.backPath).toBeNull()
  expect(result.current.forwardPath).toBeNull()
  expect(result.current.canGoBack).toBe(false)
  expect(result.current.canGoForward).toBe(false)
  expect(result.current.query).toBe('')
  expect(result.current.effectiveQuery).toBe('')
  expect(result.current.selectedEntry).toBeNull()

  act(() => result.current.initializeOpenSession(serverInfo('second-home')))

  expect(result.current.isInitialized).toBe(true)
  expect(result.current.currentPath).toBe('second-home')
  expect(result.current.canGoBack).toBe(false)
  expect(result.current.canGoForward).toBe(false)
})

test('reveals recent files in their parent and opens recent directories', () => {
  const { result } = renderHook(() => useFilePickerSession(null))
  const file = entry('tmp/readme.md', 'file')

  act(() => result.current.initializeOpenSession(serverInfo('home')))
  act(() => result.current.navigateTo('home/projects'))
  act(() => result.current.goBack())
  act(() => result.current.setQuery('readme'))
  act(() => result.current.revealEntry(file))

  expect(result.current.currentPath).toBe('tmp')
  expect(result.current.selectedEntry).toBe(file)
  expect(result.current.query).toBe('')
  expect(result.current.canGoForward).toBe(false)

  act(() => result.current.revealEntry(entry('archive', 'directory')))

  expect(result.current.currentPath).toBe('archive')
  expect(result.current.selectedEntry).toBeNull()
})

function serverInfo(defaultPath: string): ServerInfo {
  return {
    defaultPath,
    homePath: defaultPath,
    ok: true,
    workspaceRoot: '',
  }
}

function entry(path: string, type: 'directory' | 'file'): FsEntry {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 0,
    type,
    version: '1',
  }
}
