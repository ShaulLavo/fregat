import type { PackageManifest } from '../manifest.ts'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export async function withWorkspace(
  run: (workspace: {
    root: string
    put: (path: string, value: unknown) => Promise<void>
    read: (path: string) => Promise<PackageManifest>
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'release-workspace-'))
  const put = async (path: string, value: unknown) => {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, 'package.json'), JSON.stringify(value))
  }
  const read = async (path: string) =>
    JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'))
  try {
    await run({ root, put, read })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
