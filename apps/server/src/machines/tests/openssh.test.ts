import path from 'node:path'
import { expect, test } from 'vitest'

const openSshAvailable =
  process.platform === 'linux' && Bun.which('sshd') && Bun.which('ssh-keygen')
const scenarioScript = path.join(import.meta.dirname, '../../../test/openssh-scenario.ts')

test.skipIf(!openSshAvailable)(
  'real OpenSSH shares authentication while owning and releasing forwards',
  async () => {
    const result = await scenario('forwarding')
    expect(result).toEqual({
      prompts: ['confirmation', 'secret'],
      forwardStayedAlive: true,
      releasedPort: true,
      reconnects: 2,
    })
  },
)

test.skipIf(!openSshAvailable).each(['cancel-password', 'expire-password'])(
  'real OpenSSH stops after %s without another prompt or failed password attempt',
  async (name) => {
    expect(await scenario(name)).toEqual({
      cancelled: 2,
      passwordPrompts: 2,
      failedPasswordAttempts: 0,
    })
  },
)

async function scenario(name: string) {
  const child = Bun.spawn([process.execPath, scenarioScript, name], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exitCode, stderr || stdout).toBe(0)
  return JSON.parse(stdout)
}
