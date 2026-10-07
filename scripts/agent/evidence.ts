import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evidenceRoot } from './paths'

export type Evidence = {
  readonly dir: string
  readonly startedAt: Date
  file(name: string): string
  write(name: string, content: string | Uint8Array): Promise<string>
  json(name: string, value: unknown): Promise<string>
}

export async function createEvidence(verb: string, label: string): Promise<Evidence> {
  const startedAt = new Date()
  const stamp = startedAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  await mkdir(evidenceRoot, { recursive: true })
  const dir = await mkdtemp(join(evidenceRoot, `${stamp}-${verb}-${slug(label)}-`))
  const write = async (name: string, content: string | Uint8Array) => {
    const path = join(dir, name)
    await writeFile(path, content)
    return path
  }
  return {
    dir,
    startedAt,
    file: (name) => join(dir, name),
    write,
    json: (name, value) => write(name, `${JSON.stringify(value, null, 2)}\n`),
  }
}

function slug(label: string) {
  return (
    label
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'run'
  )
}
