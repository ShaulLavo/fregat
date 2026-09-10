import assert from 'node:assert/strict'

import { createSshAuthentication } from '../src/machines/authentication'
import { reserveForwardPort, runSshCommand, type SshForward } from '../src/machines/forward'
import { localOpenSsh, sshPassphrase, waitUntil } from './factories/openssh'

const scenario = process.argv[2]
const cancellation = scenario === 'cancel-password' || scenario === 'expire-password'
const ssh = await localOpenSsh(cancellation)
process.env.PATH = ssh.environment.PATH
const prompts: string[] = []
let cancelled = 0
const auth = await createSshAuthentication({
  request: async (prompt) => {
    prompts.push(prompt.kind)
    if (prompt.kind === 'confirmation') return 'yes'
    if (scenario === 'expire-password') await Bun.sleep(30)
    return cancellation ? null : sshPassphrase
  },
  onCancel: () => {
    cancelled += 1
  },
})
const forwards: SshForward[] = []

try {
  if (cancellation) await verifyCancellation()
  else await verifyForwarding()
} finally {
  await Promise.allSettled(forwards.map((forward) => forward.close()))
  await auth.close()
  await ssh.close()
}

async function command() {
  return runSshCommand({
    spawn: auth.spawn,
    target: 'fixture',
    script: 'printf ready',
    step: 'probe',
  })
}

async function verifyCancellation() {
  await assert.rejects(command())
  assert.deepEqual(prompts, ['confirmation', 'secret'])
  assert.equal(cancelled, 1)
  const log = await ssh.readLog()
  assert.doesNotMatch(log, /Failed password/)
  await assert.rejects(command(), /cancelled/)
  assert.deepEqual(prompts, ['confirmation', 'secret'])
  auth.begin()
  await assert.rejects(command())
  assert.deepEqual(prompts, ['confirmation', 'secret', 'secret'])
  const finalLog = await ssh.readLog()
  console.log(
    JSON.stringify({
      cancelled,
      passwordPrompts: prompts.filter((kind) => kind === 'secret').length,
      failedPasswordAttempts: (finalLog.match(/Failed password/g) ?? []).length,
    }),
  )
}

async function verifyForwarding() {
  assert.equal(await command(), 'ready')
  assert.deepEqual(prompts, ['confirmation', 'secret'])
  const localPort = await reserveForwardPort()
  const options = { spawn: auth.spawn, target: 'fixture', localPort, remotePort: ssh.port }
  const first = await auth.openForward(options)
  forwards.push(first)
  await waitUntil(() => portIsOccupied(localPort))
  await Bun.sleep(100)
  assert.equal(first.child.exitCode, null, 'the forwarding session must remain alive')
  await first.close()
  assert.equal(await reserveForwardPort(localPort), localPort)
  assert.equal(await command(), 'ready')
  const second = await auth.openForward(options)
  forwards.push(second)
  await waitUntil(() => portIsOccupied(localPort))
  second.child.kill('SIGTERM')
  await second.child.exited
  await second.close()
  assert.equal(await reserveForwardPort(localPort), localPort)
  const third = await auth.openForward(options)
  forwards.push(third)
  await waitUntil(() => portIsOccupied(localPort))
  assert.deepEqual(prompts, ['confirmation', 'secret'], 'reuse must not prompt for the key again')
  await auth.close()
  assert.equal(await reserveForwardPort(localPort), localPort)
  console.log(
    JSON.stringify({ prompts, forwardStayedAlive: true, releasedPort: true, reconnects: 2 }),
  )
}

async function portIsOccupied(port: number) {
  try {
    await reserveForwardPort(port)
    return false
  } catch {
    return true
  }
}
