import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { buildsTransfer } from './sync'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function scratch(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

test('copies built workspaces to their own paths from any working directory', () => {
  const root = scratch('lane-sync-root-')
  const builds = ['editor/packages/editor/dist', 'ghostty-webgpu/dist']
  for (const dist of builds) {
    mkdirSync(path.join(root, dist), { recursive: true })
    writeFileSync(path.join(root, dist, 'index.js'), '')
  }
  const destination = scratch('lane-sync-dest-')
  const elsewhere = scratch('lane-sync-cwd-')
  const [command, ...args] = buildsTransfer(root, builds, `${destination}/`)
  expect(spawnSync(command!, args, { cwd: elsewhere }).status).toBe(0)
  for (const dist of builds) expect(existsSync(path.join(destination, dist, 'index.js'))).toBe(true)
})
