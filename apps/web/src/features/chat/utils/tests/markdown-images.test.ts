import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { directInProcessFetcher } from '../../../../../test/client'
import { wallpaperPng } from '../../../../../test/factories/wallpaper'
import { expect, test } from '../../../../../test/fixtures'
import { markdownImageSource } from '../markdown-images'

test('managed chat image URLs serve exact worktree bytes while the base image stays distinct', async ({
  server,
}) => {
  const basePath = 'repo'
  const worktreePath = 'repo/.worktrees/chat-fix'
  const baseRoot = path.join(server.root, basePath)
  const worktreeRoot = path.join(server.root, worktreePath)
  const baseBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
    'base64',
  )
  const worktreeBytes = wallpaperPng()
  expect(worktreeBytes).not.toEqual(baseBytes)
  await mkdir(path.join(baseRoot, 'assets'), { recursive: true })
  await mkdir(path.join(worktreeRoot, 'assets'), { recursive: true })
  await writeFile(path.join(baseRoot, 'assets/result.png'), baseBytes)
  await writeFile(path.join(worktreeRoot, 'assets/result.png'), worktreeBytes)

  const fetcher = directInProcessFetcher(server)
  const worktreeUrl = markdownImageSource(
    'assets/result.png',
    worktreeRoot,
    server.origin,
    worktreePath,
  )
  expect(worktreeUrl).not.toBeNull()
  expect(new URL(worktreeUrl!).searchParams.get('path')).toBe(`${worktreePath}/assets/result.png`)
  const response = await fetcher(worktreeUrl!)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(worktreeBytes)

  const baseUrl = markdownImageSource('assets/result.png', baseRoot, server.origin, basePath)
  expect(baseUrl).not.toBeNull()
  const baseResponse = await fetcher(baseUrl!)
  expect(baseResponse.status).toBe(200)
  expect(Buffer.from(await baseResponse.arrayBuffer())).toEqual(baseBytes)
})
