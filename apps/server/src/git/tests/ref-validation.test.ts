import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { runGit } from '../../testing/git'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('git ref validation', () => {
  it('refuses a checkout whose branch name starts with a dash', async () => {
    const root = await fixtureRepo()

    const response = await post(root, '/git/checkout', { branch: '-dash-leading' })

    expect(response.status).toBe(400)
    const head = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    expect(head.stdout.trim()).toBe('main')
  })

  it('refuses branch creation whose branch name starts with a dash', async () => {
    const root = await fixtureRepo()

    const response = await post(root, '/git/create-branch', { branch: '-dash-leading' })

    expect(response.status).toBe(400)
    const branches = await runGit(root, ['branch', '--format=%(refname:short)'])
    expect(branches.stdout.trim()).toBe('main')
  })

  it('still accepts the ordinary ref shapes the app produces', async () => {
    const root = await fixtureRepo()

    for (const branch of ['feature/x', 'release-1.2', 'a_b.c']) {
      const created = await post(root, '/git/create-branch', { branch })
      expect(created.status).toBe(200)

      const switched = await post(root, '/git/checkout', { branch })
      expect(switched.status).toBe(200)
      const head = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
      expect(head.stdout.trim()).toBe(branch)
    }
  })
})

async function post(root: string, route: string, body: unknown) {
  return testApp(root).handle(
    new Request(`http://local${route}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
      method: 'POST',
    }),
  )
}

function testApp(root: string) {
  return createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
}

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-git-refs-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await runGit(root, ['add', 'tracked.txt'])
  await runGit(root, ['commit', '-m', 'initial'])
  return root
}
