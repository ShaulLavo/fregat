import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProviderInstanceId } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexProviderAdapter } from '../adapters/codex'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { ProviderMaintenance } from '../provider-maintenance'

const CODEX = 'codex' as ProviderInstanceId
const LATEST = '0.200.0'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

/** A codex that answers `--version` from a file, and whose `update` rewrites it. */
const FAKE_CODEX = `#!/bin/sh
dir=$(dirname "$0")
case "$1" in
  --version) echo "codex-cli $(cat "$dir/version")" ;;
  update)
    echo run >> "$dir/updates"
    if [ -f "$dir/fail" ]; then echo "registry unreachable" >&2; exit 3; fi
    sleep 0.2
    echo ${LATEST} > "$dir/version"
    echo "Updated Codex" ;;
  *) exit 1 ;;
esac
`

async function fakeInstall(installDir: string, version = '0.150.0') {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-provider-update-'))
  roots.push(root)
  const bin = path.join(root, installDir)
  await mkdir(bin, { recursive: true })
  const binary = path.join(bin, 'codex')
  await writeFile(binary, FAKE_CODEX)
  await chmod(binary, 0o755)
  await writeFile(path.join(bin, 'version'), `${version}\n`)

  const registry = new ProviderAdapterRegistry([
    new CodexProviderAdapter({ env: { ...process.env, PLATFORM_CODEX_BINARY: binary } }),
  ])
  const fetched: string[] = []
  const maintenance = new ProviderMaintenance(registry, {
    fetcher: async (url) => {
      fetched.push(String(url))
      return Response.json({ version: LATEST })
    },
  })
  const updates = async () =>
    (await readFile(path.join(bin, 'updates'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

  return { bin, fetched, maintenance, updates }
}

describe('ProviderMaintenance', () => {
  it('updates a standalone install once, however many clicks arrive while it runs', async () => {
    const { fetched, maintenance, updates } = await fakeInstall('packages/standalone/bin')

    expect(await maintenance.advisory(CODEX)).toMatchObject({
      canUpdate: true,
      command: 'codex update',
      installedVersion: '0.150.0',
      latestVersion: LATEST,
      method: 'native',
      status: 'behind',
    })

    const results = await Promise.all([maintenance.update(CODEX), maintenance.update(CODEX)])
    expect(results.map((result) => result.outcome).toSorted()).toEqual(['unchanged', 'updated'])
    expect(results[0]?.advisory).toMatchObject({ installedVersion: LATEST, status: 'current' })
    expect(await updates()).toHaveLength(1)
    expect(fetched).toEqual(['https://registry.npmjs.org/@openai/codex/latest'])
    maintenance.close()
  })

  it('reports a failed update with the command’s own words and leaves the CLI as it was', async () => {
    const { bin, maintenance } = await fakeInstall('packages/standalone/bin')
    await writeFile(path.join(bin, 'fail'), '')

    await expect(maintenance.update(CODEX)).rejects.toMatchObject({
      message: '`codex update` exited with code 3.',
      why: 'registry unreachable',
    })
    expect((await maintenance.advisory(CODEX)).installedVersion).toBe('0.150.0')
    maintenance.close()
  })

  it('names the command for an install a version manager owns, and never runs it', async () => {
    const { maintenance, updates } = await fakeInstall('mise/installs/codex/0.150.0/bin')

    expect(await maintenance.advisory(CODEX)).toMatchObject({
      canUpdate: false,
      command: 'mise upgrade codex',
      method: 'mise',
      status: 'behind',
    })
    await expect(maintenance.update(CODEX)).rejects.toMatchObject({
      message: 'This CLI updates from outside the app.',
    })
    expect(await updates()).toEqual([])
    maintenance.close()
  })
})
