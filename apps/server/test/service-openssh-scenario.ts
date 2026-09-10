import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MachineAuthPrompt } from '@workspace/contracts'
import { MachineService } from '../src/machines/service'
import { reserveForwardPort } from '../src/machines/forward'
import { shellQuote } from '../src/utils/shell'
import { installServerLauncher } from '../src/installation/install'
import { localOpenSsh, sshPassphrase, waitUntil } from './factories/openssh'

const descriptor = {
  ok: true,
  environmentId: '00000000-0000-4000-8000-000000000079',
  label: 'service SSH fixture',
  protocolVersion: 1,
  serverVersion: 'test',
  platform: { os: 'linux', arch: 'x64' },
}
const directory = await mkdtemp(path.join(tmpdir(), 'platform-service-openssh-'))
const project = path.resolve(import.meta.dir, '../../..')
const checkout = path.join(directory, 'checkout')
const bin = path.join(directory, 'bin')
const preload = path.join(directory, 'health.ts')
await mkdir(bin)
await mkdir(checkout)
for (const name of ['apps', 'packages', 'node_modules'])
  await symlink(path.join(project, name), path.join(checkout, name))
await writeFile(
  preload,
  `globalThis.fetch = async () => Response.json(${JSON.stringify(descriptor)});`,
)
await writeFile(
  path.join(bin, 'bun'),
  `#!/bin/sh\nexec ${shellQuote(process.execPath)} --preload ${shellQuote(preload)} "$@"\n`,
  { mode: 0o700 },
)
const installedLauncher = await installServerLauncher({
  homeDirectory: directory,
  installation: { kind: 'source', directory: checkout, executable: path.join(bin, 'bun') },
})
await symlink(installedLauncher, path.join(bin, 'platform-server'))
const ssh = await localOpenSsh(false, `${bin}:/usr/local/bin:/usr/bin:/bin`)
process.env.PATH = ssh.environment.PATH
const service = new MachineService({
  environmentId: 'service-openssh-test',
  webOrigin: 'http://localhost:3000',
  readMachines: () => ({
    fixture: { kind: 'ssh', target: 'fixture', remotePort: ssh.port },
  }),
  fetcher: Object.assign(async () => Response.json(descriptor), { preconnect: fetch.preconnect }),
})
const prompts = new Map<string, MachineAuthPrompt | null>()
const secretPrompts: string[] = []
const controllers: AbortController[] = []
const subscriptions: Promise<void>[] = []

try {
  await subscribe('first')
  if (process.argv[2] === 'transfer') await verifyTransfer()
  else await verifyCancellation()
} finally {
  for (const controller of controllers) controller.abort()
  await service.close()
  await Promise.all(subscriptions)
  await ssh.close()
  await rm(directory, { recursive: true, force: true })
}

async function subscribe(client: string) {
  const controller = new AbortController()
  controllers.push(controller)
  subscriptions.push(
    (async () => {
      for await (const event of service.changes(client, controller.signal)) {
        if (event.kind !== 'auth') continue
        prompts.set(client, event.prompt)
        if (event.prompt?.kind === 'secret') secretPrompts.push(client)
        if (event.prompt?.kind === 'confirmation')
          await service.respond('fixture', client, event.prompt.id, 'yes')
      }
    })(),
  )
  await waitUntil(async () => prompts.has(client))
}

async function passwordPrompt(client: string) {
  await waitUntil(async () => prompts.get(client)?.kind === 'secret')
  const prompt = prompts.get(client)
  assert.ok(prompt)
  return prompt
}

async function verifyTransfer() {
  await subscribe('second')
  const first = service.connect('fixture', 'first')
  const second = service.connect('fixture', 'second')
  const original = await passwordPrompt('first')
  await service.respond('fixture', 'first', original.id, null)
  const transferred = await passwordPrompt('second')
  assert.equal(transferred.id, original.id)
  assert.equal(prompts.get('first'), null)
  await assert.rejects(service.respond('fixture', 'first', original.id, sshPassphrase))
  await service.respond('fixture', 'second', transferred.id, sshPassphrase)
  const [withdrawn, connected] = await Promise.all([first, second])
  assert.equal(withdrawn.phase, 'idle', JSON.stringify(withdrawn))
  assert.equal(connected.phase, 'live', JSON.stringify(connected))
  const port = Number(new URL((await service.resolve('fixture')).origin).port)
  await service.disconnect('fixture', 'second')
  await assert.rejects(service.resolve('fixture'))
  assert.equal(await reserveForwardPort(port), port)
  console.log(
    JSON.stringify({
      withdrawn: withdrawn.phase,
      survivor: connected.phase,
      promptTransferred: true,
      soleOwnerReleasedForward: true,
    }),
  )
}

async function verifyCancellation() {
  const connecting = service.connect('fixture', 'first')
  const prompt = await passwordPrompt('first')
  await service.respond('fixture', 'first', prompt.id, null)
  const cancelled = await connecting
  assert.equal(cancelled.phase, 'blocked', JSON.stringify(cancelled))
  await Bun.sleep(100)
  assert.equal(prompts.get('first'), null)
  assert.deepEqual(secretPrompts, ['first'])
  const reconnecting = service.connect('fixture', 'first')
  const retry = await passwordPrompt('first')
  await service.respond('fixture', 'first', retry.id, sshPassphrase)
  const connected = await reconnecting
  assert.equal(connected.phase, 'live', JSON.stringify(connected))
  console.log(
    JSON.stringify({
      cancelled: cancelled.phase,
      secretPromptsBeforeRetry: 1,
      explicitRetry: connected.phase,
    }),
  )
}
