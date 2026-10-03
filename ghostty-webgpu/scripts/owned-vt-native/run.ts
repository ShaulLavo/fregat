import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArtifactBuildError, verifyCleanSource } from '../ghostty-source.js'
import { runProof } from './proof.js'

const nativePin = 'befcdfd2c3a1cb24d9ec886e93c95b2b5daa7028'
const editorPin = '8cdc43dbf013e0f826e8413893b7c529edfc54e2'
const directory = dirname(fileURLToPath(import.meta.url))

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new ArtifactBuildError(`${name} requires a value`)
  return value
}

async function git(cwd: string, args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'inherit' })
  const output = await new Response(child.stdout).text()
  if (await child.exited) throw new ArtifactBuildError('Unable to inspect proof source revision')
  return output.trim()
}

async function hash(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

const sourceArgument = argument('--source')
const editorArgument = argument('--editor-source')
if (!sourceArgument || !editorArgument) {
  console.log(
    'SKIP owned-VT native proof: pass --source (official Ghostty checkout) and --editor-source (ReadSession checkpoint package). Requires Bun, Git and Zig 0.16+.',
  )
  process.exit(0)
}
const source = resolve(sourceArgument)
const editor = resolve(editorArgument)
await verifyCleanSource(source)
if ((await git(source, ['rev-parse', 'HEAD'])) !== nativePin)
  throw new ArtifactBuildError(`Native proof requires official Ghostty ${nativePin}`)
if ((await git(editor, ['rev-parse', 'HEAD'])) !== editorPin)
  throw new ArtifactBuildError(`ReadSession proof requires checkpoint ${editorPin}`)
if (await git(editor, ['status', '--porcelain=v1', '--', '.']))
  throw new ArtifactBuildError('ReadSession checkpoint package must be clean')
const evidenceArgument = argument('--evidence')
if (!evidenceArgument) throw new ArtifactBuildError('--evidence requires a new run directory')
const evidence = resolve(evidenceArgument)
await mkdir(evidence)
const workspace = await mkdtemp(
  join(resolve(argument('--scratch') ?? tmpdir()), 'owned-vt-native-'),
)
const records: string[] = []
const receipt = (value: Record<string, unknown>) => records.push(JSON.stringify(value))
const sources = ['build.zig', 'terminal.c', 'native.ts', 'proof.ts', 'run.ts']
if (!process.argv.includes('--missing-renderer')) sources.push('owner.ts')
const hashes = Object.fromEntries(
  await Promise.all(sources.map(async (file) => [file, await hash(join(directory, file))])),
)
const editorHashes = Object.fromEntries(
  await Promise.all(
    ['session.ts', 'model.ts', 'history.ts', 'keymap.ts', 'structured-errors.ts'].map(
      async (file) => [file, await hash(join(editor, 'src', file))],
    ),
  ),
)
const metadata = {
  nativePin,
  editorPin,
  checkout: await git(directory, ['rev-parse', 'HEAD']),
  missingRenderer: process.argv.includes('--missing-renderer'),
  hashes,
  editorHashes,
}
receipt({ kind: 'pins', ...metadata })
await writeFile(join(evidence, 'sources.json'), `${JSON.stringify(metadata, null, 2)}\n`)
console.log(JSON.stringify(metadata))
try {
  const binaryArgument = argument('--binary')
  if (binaryArgument) {
    const previous = resolve(binaryArgument)
    const info = JSON.parse(await readFile(join(dirname(previous), 'sources.json'), 'utf8'))
    const binaryRecord = (await readFile(join(dirname(previous), 'records.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((record) => record.kind === 'binary')
    if (
      info.nativePin !== nativePin ||
      info.hashes['terminal.c'] !== hashes['terminal.c'] ||
      info.hashes['build.zig'] !== hashes['build.zig'] ||
      binaryRecord?.sha256 !== (await hash(previous))
    )
      throw new ArtifactBuildError('Reused native binary must match its source and binary receipts')
    const binary = join(evidence, 'owned-vt-terminal')
    await copyFile(previous, binary)
    receipt({ kind: 'binary', sha256: await hash(binary), path: binary, reusedFrom: previous })
    await runProof(binary, editor, process.argv.includes('--missing-renderer'), receipt)
  } else {
    for (const file of ['build.zig', 'terminal.c'])
      await copyFile(join(directory, file), join(workspace, file))
    await writeFile(
      join(workspace, 'build.zig.zon'),
      `.{
    .name = .positional_native,
    .version = "0.0.0",
    .fingerprint = 0x84650620d74bc354,
    .minimum_zig_version = "0.16.0",
    .dependencies = .{ .ghostty = .{ .path = ${JSON.stringify(relative(workspace, source))} } },
    .paths = .{ "build.zig", "build.zig.zon", "terminal.c" },
  }`,
    )
    const build = Bun.spawn(
      [
        argument('--zig') ?? 'zig',
        'build',
        '--summary',
        'all',
        '--system',
        argument('--packages') ??
          join(process.env['ZIG_GLOBAL_CACHE_DIR'] ?? join(tmpdir(), 'zig-cache'), 'p'),
      ],
      { cwd: workspace, stdout: 'inherit', stderr: 'inherit' },
    )
    const code = await build.exited
    receipt({ kind: 'build', code })
    if (code) throw new ArtifactBuildError(`Native proof build exited with status ${code}`)
    const binary = join(evidence, 'owned-vt-terminal')
    await copyFile(join(workspace, 'zig-out/bin/owned-vt-terminal'), binary)
    receipt({ kind: 'binary', sha256: await hash(binary), path: binary })
    await runProof(binary, editor, process.argv.includes('--missing-renderer'), receipt)
  }
} finally {
  const content = `${records.join('\n')}\n`
  await writeFile(join(evidence, 'records.jsonl'), content)
  await writeFile(
    join(evidence, 'records.sha256'),
    `${createHash('sha256').update(content).digest('hex')}  records.jsonl\n`,
  )
  for (const file of sources) await copyFile(join(directory, file), join(evidence, file))
  await rm(workspace, { recursive: true, force: true })
}
