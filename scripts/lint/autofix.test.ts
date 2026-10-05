import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'

const repository = resolve(import.meta.dirname, '../..')
const source = `import assert from 'node:assert/strict'
const bytes = new Uint8ClampedArray([1, 2, 3, 255])
const target = { frame: { getImage: () => ({ data: bytes }) } }
assert.deepEqual([...target.frame.getImage().data.slice(0, 4)], [1, 2, 3, 255])
assert.deepEqual([...[1, 2, 3, 255].slice(0, 4)], [1, 2, 3, 255])
const { byteLength: byteLength } = bytes
assert.equal(byteLength, 4)
`

test('the commit autofix preserves typed-array conversion and keeps other safe fixes', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'platform-autofix-'))
  const file = join(fixture, 'bytes.ts')
  try {
    await writeFile(file, source)
    const bun = Bun.which('bun') ?? 'bun'
    expect(await execute([bun, file])).toMatchObject({ exitCode: 0, errors: '' })
    const hooks = await readFile(join(repository, 'lefthook.yml'), 'utf8')
    const command = hooks.match(/- name: lint fix staged files\n[^\n]+\n\s+run: ([^\n]+)/u)?.[1]
    if (!command) return expect.unreachable('Expected the commit lint autofix command')
    const fixed = await execute(
      ['sh', '-c', command.replace('{staged_files}', '"$LINT_FIXTURE_PATH"')],
      { LINT_FIXTURE_PATH: file },
    )
    expect(fixed.exitCode, fixed.errors).toBe(0)
    expect(await execute([bun, file])).toMatchObject({ exitCode: 0, errors: '' })
    const result = await readFile(file, 'utf8')
    expect(result).toContain('[...target.frame.getImage().data.slice(0, 4)]')
    expect(result).not.toContain('byteLength: byteLength')
    const checked = await execute([
      bun,
      join(repository, 'node_modules/oxlint/bin/oxlint'),
      '--format',
      'json',
      file,
    ])
    expect(checked.exitCode, checked.errors).toBe(0)
    expect(checked.output).toContain('unicorn(no-useless-spread)')
  } finally {
    await rm(fixture, { force: true, recursive: true })
  }
})

async function execute(command: string[], environment: Record<string, string> = {}) {
  const process = Bun.spawn(command, {
    cwd: repository,
    env: { ...globalThis.process.env, ...environment },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, output, errors] = await Promise.all([
    process.exited,
    Bun.readableStreamToText(process.stdout),
    Bun.readableStreamToText(process.stderr),
  ])
  return { exitCode, output, errors }
}
