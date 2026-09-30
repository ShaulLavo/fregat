import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'release-workspace-'))
  const put = async (path, value) => {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, 'package.json'), JSON.stringify(value))
  }
  const read = async (path) => JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'))
  try {
    await run({ root, put, read })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
