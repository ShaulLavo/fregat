import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { prerequisitesScript } from './prerequisites'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

// A PATH holding only the named tools, plus a sudo that records what it was asked to run.
function install(present: readonly string[]) {
  const bin = mkdtempSync(path.join(tmpdir(), 'lane-prereq-'))
  roots.push(bin)
  const log = path.join(bin, 'sudo.log')
  for (const tool of present) writeFileSync(path.join(bin, tool), '#!/bin/sh\n')
  writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh\necho "$@" >> ${log}\n`)
  for (const tool of [...present, 'sudo']) chmodSync(path.join(bin, tool), 0o755)
  const result = spawnSync('/bin/bash', ['-c', prerequisitesScript()], { env: { PATH: bin } })
  expect(result.status).toBe(0)
  return existsSync(log) ? readFileSync(log, 'utf8') : ''
}

test('installs rsync when git is already there', () => {
  expect(install(['git']).trim()).toBe(
    'env DEBIAN_FRONTEND=noninteractive apt-get install -y -q rsync',
  )
})

test('installs both when neither is there, and nothing when both are', () => {
  expect(install([]).trim()).toBe(
    'env DEBIAN_FRONTEND=noninteractive apt-get install -y -q git rsync',
  )
  expect(install(['git', 'rsync'])).toBe('')
})
