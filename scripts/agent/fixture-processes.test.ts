import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { processesIn } from './fixture-processes'
import { releaseFixture } from './fixture-workspace'
import { scratchPath } from './paths'

it('finds fixture processes, filters stdin and leaves other directories alone during cleanup', async () => {
  const fixture = await mkdtemp(scratchPath('fregat-cleanup-'))
  const other = await mkdtemp(scratchPath('fregat-unrelated-'))
  const input = path.join(fixture, 'stdin.txt')
  await writeFile(input, 'fixture')
  const command = [process.execPath, '-e', 'setInterval(() => {}, 1000)']
  const owned = Bun.spawn(command, {
    cwd: fixture,
    stdin: Bun.file(input),
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const unrelated = Bun.spawn(command, { cwd: other, stdout: 'ignore', stderr: 'ignore' })
  try {
    await expect.poll(() => processesIn(fixture)).toContain(owned.pid)
    expect(await processesIn(fixture)).not.toContain(unrelated.pid)
    expect(await processesIn(fixture, (target) => target === input)).toContain(owned.pid)
    expect(await processesIn(fixture, (target) => target === 'absent')).toEqual([])
    await releaseFixture(fixture)
    await owned.exited
    expect(existsSync(fixture)).toBe(false)
    expect(unrelated.exitCode).toBeNull()
  } finally {
    if (owned.exitCode === null) owned.kill()
    if (unrelated.exitCode === null) unrelated.kill()
    await Promise.all([owned.exited, unrelated.exited])
    await Promise.all([
      rm(fixture, { recursive: true, force: true }),
      rm(other, { recursive: true, force: true }),
    ])
  }
}, 20_000)
