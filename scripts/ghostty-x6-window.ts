import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeX6, x6Protocol, type TimingBlock } from './ghostty-x6-statistics.ts'

interface Registration {
  readonly label: string
  readonly sourceHead: string
  readonly actualBase: string
  readonly reviewReference: string
  readonly protocol: typeof x6Protocol
  readonly protocolHash: string
  readonly node: { readonly path: string; readonly version: string; readonly hash: string }
  readonly bundle: string
  readonly files: Readonly<Record<string, string>>
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command, inputArgument, outputArgument, approval] = process.argv.slice(2)
assert(inputArgument && outputArgument)
const input = resolve(inputArgument)
const output = resolve(outputArgument)
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const git = (...args: string[]): string => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

if (command === 'freeze') await freezeInputs()
if (command === 'run') await runWindow()
assert(command === 'freeze' || command === 'run')

async function freezeInputs(): Promise<void> {
  assert(
    approval && approval.startsWith('https://github.com/'),
    'Independent review reference required',
  )
  assert.equal(git('status', '--porcelain'), '', 'Checkpoint must be clean')
  const manifest = JSON.parse(await readFile(join(input, 'manifest.json'), 'utf8')) as {
    sourceHead: string
    actualBase: string
    sourceStatus: string
    sourceHashes: Record<string, string>
    artifacts: Record<string, string>
  }
  assert.equal(manifest.sourceHead, git('rev-parse', 'HEAD'))
  assert.equal(manifest.actualBase, x6Protocol.actualBase)
  assert.equal(manifest.sourceStatus, '')
  const verification = JSON.parse(
    await readFile(join(input, 'counter-verification.json'), 'utf8'),
  ) as { passed: boolean }
  assert.equal(verification.passed, true)
  const files: Record<string, string> = {}
  for (const [file, expected] of Object.entries(manifest.sourceHashes)) {
    const source = join(root, 'ghostty-webgpu', file)
    assert.equal(hash(await readFile(source)), expected)
    const original = spawnSync('git', [
      '-C',
      root,
      'show',
      `${x6Protocol.actualBase}:ghostty-webgpu/${file}`,
    ])
    assert.equal(original.status, 0)
    assert.equal(hash(original.stdout), expected, `Actual-base source ${file}`)
    files[source] = expected
  }
  for (const [file, expected] of Object.entries(manifest.artifacts)) {
    const artifact = join(input, file)
    assert.equal(hash(await readFile(artifact)), expected)
    files[artifact] = expected
  }
  for (const file of [
    'scripts/ghostty-x6-in-process.ts',
    'scripts/ghostty-x6-source-ledger.ts',
    'scripts/ghostty-x6-source-ledger.test.ts',
    'scripts/ghostty-x6-statistics.ts',
    'scripts/ghostty-x6-statistics.test.ts',
    'scripts/ghostty-x6-window.ts',
    'ghostty-webgpu/bench/extension-process-entry.ts',
    'ghostty-webgpu/src/extensions/tests/process-source.test.ts',
    'ghostty-webgpu/ghostty-vt.provenance.json',
    'bun.lock',
  ])
    files[join(root, file)] = hash(await readFile(join(root, file)))
  for (const file of [
    'manifest.json',
    'sites.json',
    'counter-verification.json',
    'instrumented/counters.json',
    'uninstrumented/smoke.json',
  ])
    files[join(input, file)] = hash(await readFile(join(input, file)))
  const nodePath = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' })
  assert.equal(nodePath.status, 0)
  const node = nodePath.stdout.trim()
  const version = spawnSync(node, ['--version'], { encoding: 'utf8' })
  assert.equal(version.status, 0)
  const registration: Registration = {
    label: x6Protocol.label,
    sourceHead: manifest.sourceHead,
    actualBase: manifest.actualBase,
    reviewReference: approval,
    protocol: x6Protocol,
    protocolHash: hash(JSON.stringify(x6Protocol)),
    node: { path: node, version: version.stdout.trim(), hash: hash(await readFile(node)) },
    bundle: join(input, 'uninstrumented/entry.mjs'),
    files,
  }
  await writeFile(output, JSON.stringify(registration, null, 2), { flag: 'wx' })
  console.log(
    JSON.stringify({
      registration: output,
      sha256: hash(await readFile(output)),
      timingWindow: 'Not started; coordinator must register this exact SHA before run.',
    }),
  )
}

async function runWindow(): Promise<void> {
  assert(approval && /^[0-9a-f]{64}$/.test(approval), 'Exact registered SHA required')
  const bytes = await readFile(input)
  assert.equal(hash(bytes), approval)
  const registration = JSON.parse(bytes.toString()) as Registration
  assert.equal(registration.label, x6Protocol.label)
  assert.equal(registration.actualBase, x6Protocol.actualBase)
  assert.equal(registration.sourceHead, git('rev-parse', 'HEAD'))
  assert.equal(git('status', '--porcelain'), '')
  assert.equal(registration.protocolHash, hash(JSON.stringify(x6Protocol)))
  assert.deepEqual(registration.protocol, x6Protocol)
  for (const [file, expected] of Object.entries(registration.files))
    assert.equal(hash(await readFile(file)), expected, file)
  assert.equal(hash(await readFile(registration.node.path)), registration.node.hash)
  const version = spawnSync(registration.node.path, ['--version'], { encoding: 'utf8' })
  assert.equal(version.status, 0)
  assert.equal(version.stdout.trim(), registration.node.version)
  // Exclusive creation makes every started directory a consumed window, including failures.
  await mkdir(output)
  await writeFile(
    join(output, 'started.json'),
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        registrationSha256: approval,
        argv: process.argv,
        protocol: x6Protocol,
      },
      null,
      2,
    ),
  )
  await copyFile(input, join(output, 'registration.json'))
  const blocks: TimingBlock[] = []
  const failures: object[] = []
  for (let block = 0; block < x6Protocol.blocks; block += 1) {
    const directory = join(output, `block-${String(block).padStart(2, '0')}`)
    await mkdir(directory)
    for (const name of ['ghostty-vt.wasm', 'bridge.wasm'])
      await copyFile(join(dirname(registration.bundle), name), join(directory, name))
    const argv = [registration.bundle, directory, 'block']
    const child = spawnSync(registration.node.path, argv, { encoding: 'utf8', timeout: 60_000 })
    const receipt = {
      block,
      executable: registration.node.path,
      argv,
      status: child.status,
      signal: child.signal,
      error: child.error?.message,
    }
    await writeFile(join(directory, 'stdout.log'), child.stdout ?? '')
    await writeFile(join(directory, 'stderr.log'), child.stderr ?? '')
    await appendFile(join(output, 'raw.jsonl'), JSON.stringify(receipt) + '\n')
    if (child.status !== 0) {
      failures.push(receipt)
      continue
    }
    try {
      blocks.push(JSON.parse(await readFile(join(directory, 'block.json'), 'utf8')) as TimingBlock)
    } catch (cause) {
      failures.push({ ...receipt, parseFailure: String(cause) })
    }
  }
  if (failures.length) {
    await writeFile(
      join(output, 'result.json'),
      JSON.stringify(
        {
          label: x6Protocol.label,
          passed: false,
          failures,
          completedBlocks: blocks.length,
          pending: x6Protocol.pending,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
    return
  }
  try {
    const result = analyzeX6(blocks)
    await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
    if (!result.passed) process.exitCode = 1
  } catch (cause) {
    await writeFile(
      join(output, 'result.json'),
      JSON.stringify(
        {
          label: x6Protocol.label,
          passed: false,
          oracleFailure: String(cause),
          completedBlocks: blocks.length,
          pending: x6Protocol.pending,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
  }
}
