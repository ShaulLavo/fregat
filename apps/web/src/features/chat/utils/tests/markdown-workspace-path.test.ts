import { expect, test } from '../../../../../test/fixtures'
import {
  markdownServerFilePath,
  markdownWorkspaceFilePath,
} from '@/features/chat/utils/markdown-workspace-path'

test('a file under the server root maps relative to it, whatever workspace the chat is in', () => {
  const root = '/work/projects/platform'
  const workspace = 'work/projects/platform'
  expect(markdownServerFilePath('/work/tmp/deploy.log', root, workspace)).toBe(
    'work/tmp/deploy.log',
  )
  expect(markdownServerFilePath(`${root}/src/a.ts`, root, workspace)).toBe(`${workspace}/src/a.ts`)
  expect(markdownServerFilePath('/srv/data/a.ts', '/srv/data/repo', 'repo')).toBe('a.ts')
  expect(markdownServerFilePath('/srv/data/a.ts', '/srv/data', '')).toBe('a.ts')
  expect(markdownServerFilePath('/etc/hosts', '/srv/data/repo', 'repo')).toBeNull()
  expect(markdownServerFilePath('/srv/database/a.ts', '/srv/data/repo', 'repo')).toBeNull()
})

test('a root the workspace path does not end in has no server root to map against', () => {
  // A symlinked checkout: the canonical path is the real one, the workspace path the link.
  expect(markdownServerFilePath('/work/tmp/a.log', '/work/projects/app', 'work/repos/app')).toBe(
    null,
  )
  expect(
    markdownServerFilePath('/work/projects/app/a.ts', '/work/projects/app', 'work/repos/app'),
  ).toBe('work/repos/app/a.ts')
  expect(markdownServerFilePath('/work/tmp/a.log', 'repo', 'repo')).toBeNull()
})

test('under a relative editor root a relative path is already the server path', () => {
  expect(markdownServerFilePath('repo/src/a.ts', 'repo', 'repo')).toBe('repo/src/a.ts')
  expect(markdownServerFilePath('work/tmp/a.log', 'work/projects/app', 'work/projects/app')).toBe(
    'work/tmp/a.log',
  )
  expect(markdownServerFilePath('../a.log', 'repo', 'repo')).toBeNull()
})

test('workspace paths stay inside the workspace', () => {
  expect(
    markdownWorkspaceFilePath('/work/tmp/a.log', '/work/projects/app', 'work/projects/app'),
  ).toBe(null)
})
