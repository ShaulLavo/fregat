import { expect, test } from 'vitest'
import { withUpdateLock } from '../update-lock'
import type { SshSpawner } from '../forward'
import { localSsh, updateFixture } from '../../../test/factories/remote-server-update'

test('cancellation keeps the remote lock alive until rollback finishes', async () => {
  const { home, serverRoot } = await updateFixture()
  const ssh = localSsh({ home })
  const controller = new AbortController()
  const entered = Promise.withResolvers<void>()
  const restored = Promise.withResolvers<void>()
  let kills = 0
  const spawn: SshSpawner = (command, stdin) => {
    const child = ssh.spawn(command, stdin)
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      get exitCode() {
        return child.exitCode
      },
      get signalCode() {
        return child.signalCode
      },
      kill(signal) {
        kills += 1
        child.kill(signal)
      },
    }
  }
  const transaction = withUpdateLock(
    { spawn, target: 'fixture', signal: controller.signal },
    serverRoot,
    process.execPath,
    async () => {
      controller.abort()
      entered.resolve()
      await restored.promise
    },
  )
  try {
    await entered.promise
    expect(kills).toBe(0)
  } finally {
    restored.resolve()
    await transaction
  }
  expect(kills).toBe(1)
})
