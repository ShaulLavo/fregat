import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

test.each(['missing', 'empty', 'valid'])(
  'launcher validates %s agents before executing Claude',
  (state) => {
    const scratch = mkdtempSync(join(import.meta.dirname, '.launch-test-'))
    const agentsPath = join(scratch, 'agents.json')
    const copyPath = join(scratch, 'launch.sh')
    const recordPath = join(scratch, 'arguments')
    const bin = join(scratch, 'bin')
    const contents =
      '{"sol":{"description":"Local test agent","prompt":"test","model":"gpt-6.1-sol"}}'
    try {
      mkdirSync(bin)
      const claude = join(bin, 'claude')
      writeFileSync(claude, `#!/bin/bash\nprintf '%s\\0' "$@" > '${recordPath}'\n`)
      chmodSync(claude, 0o755)
      const copy = Bun.spawnSync([
        'sed',
        `s|/work/cli-proxy-api/agents.json|${agentsPath}|g`,
        join(import.meta.dirname, 'launch.sh'),
      ])
      expect(copy.exitCode).toBe(0)
      writeFileSync(copyPath, copy.stdout)
      if (state !== 'missing') writeFileSync(agentsPath, state === 'empty' ? '' : contents)
      const result = Bun.spawnSync(
        ['bash', copyPath, '--model', 'claude-opus-5-5', 'extra argument'],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
      )
      if (state === 'valid') {
        expect(result.exitCode).toBe(0)
        expect(readFileSync(recordPath, 'utf8').split('\0').slice(0, -1)).toEqual([
          '--agents',
          contents,
          '--model',
          'claude-opus-5-5',
          'extra argument',
        ])
        return
      }
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(
        'agents.json must be readable and contain agent definitions',
      )
      expect(existsSync(recordPath)).toBe(false)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
)
