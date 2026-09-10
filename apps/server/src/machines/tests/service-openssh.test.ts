import path from 'node:path'
import { expect, test } from 'vitest'

const available = process.platform === 'linux' && Bun.which('sshd') && Bun.which('ssh-keygen')
const scenario = path.join(import.meta.dirname, '../../../test/service-openssh-scenario.ts')

test.skipIf(!available).each([
  [
    'transfer',
    {
      withdrawn: 'idle',
      survivor: 'live',
      promptTransferred: true,
      soleOwnerReleasedForward: true,
    },
  ],
  ['cancel', { cancelled: 'blocked', secretPromptsBeforeRetry: 1, explicitRetry: 'live' }],
] as const)(
  'real OpenSSH service %s preserves authentication ownership',
  async (name, expected) => {
    const child = Bun.spawn([process.execPath, scenario, name], { stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr || stdout).toBe(0)
    expect(JSON.parse(stdout)).toEqual(expected)
  },
)
