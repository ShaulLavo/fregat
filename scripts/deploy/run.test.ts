import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

test.each([0, 7])('logged commands expose their failure output for exit %s', (code) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-command-log-'))
  try {
    const log = path.join(directory, 'build.log')
    writeFileSync(log, 'earlier-command-private-output\n')
    const module = path.join(import.meta.dirname, 'run.ts')
    const child = `process.stdout.write('compiler diagnostic\\n'); process.stderr.write('compiler failure\\n'); process.exit(${code})`
    const source = `
      import { run } from ${JSON.stringify(module)};
      const result = await run(${JSON.stringify([process.execPath, '-e', child])}, {
        log: ${JSON.stringify(log)},
        env: { ...process.env, PRIVATE_BUILD_SENTINEL: 'environment-private-value' },
      });
      console.log(JSON.stringify(result));
    `
    const result = Bun.spawnSync([process.execPath, '-e', source], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({
      code,
      stdout: 'compiler diagnostic\n',
    })
    const recorded = readFileSync(log, 'utf8')
    expect(recorded).toContain('compiler diagnostic\ncompiler failure\n')
    expect(recorded).toContain(`[exit ${code}]`)
    const terminal = result.stderr.toString()
    if (code === 0) expect(terminal).toBe('')
    if (code !== 0) {
      expect(terminal).toContain('compiler diagnostic\ncompiler failure\n')
      expect(terminal).toContain(`[exit ${code}]`)
    }
    expect(terminal).not.toContain('earlier-command-private-output')
    expect(terminal).not.toContain('environment-private-value')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
