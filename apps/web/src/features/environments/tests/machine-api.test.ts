import { onTestFinished } from 'vitest'
import { machineConnectionStateSchema, type MachineAuthPrompt } from '@workspace/contracts'
import * as v from 'valibot'
import { machinesForApp } from 'server/testing'
import { fakeSsh, machine } from '../../../../../server/test/factories/ssh'
import { MachinePrompts } from '../../../../../server/src/machines/prompts'
import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

test('connects through the backend and retains a shared tunnel until the last client disconnects', async () => {
  const ssh = await fakeSsh()
  const server = await makeTestServer({ machines: ssh, filesystemWatch: false })
  onTestFinished(server.cleanup)
  const client = createInProcessClient(server)
  const saved = await client.settings.write.post({
    mutationId: 'ssh-api-configure',
    target: 'user',
    operations: [{ kind: 'machine.set', name: 'fixture', machine }],
  })
  expect(saved.error).toBeNull()
  const first = await client.machines({ name: 'fixture' }).connect.post(undefined, {
    headers: { 'x-client-instance': 'first-tab' },
  })
  const state = v.parse(machineConnectionStateSchema, first.data)
  expect(state).toMatchObject({ phase: 'live', origin: '/machines/fixture/proxy' })
  expect(ssh.forwardChildren).toHaveLength(1)
  const second = await client.machines({ name: 'fixture' }).connect.post(undefined, {
    headers: { 'x-client-instance': 'second-tab' },
  })
  expect(second.data).toMatchObject({ phase: 'live' })
  expect(ssh.forwardChildren).toHaveLength(1)
  await client.machines({ name: 'fixture' }).disconnect.post(undefined, {
    headers: { 'x-client-instance': 'first-tab' },
  })
  expect(ssh.forwardChildren[0]?.exitCode).toBeNull()
  expect(ssh.forwardChildren[0]?.signalCode).toBeNull()
  await client.machines({ name: 'fixture' }).disconnect.post(undefined, {
    headers: { 'x-client-instance': 'second-tab' },
  })
  expect(ssh.forwardChildren[0]?.signalCode).not.toBeNull()
})

test('refuses untrusted origins and unconfigured SSH names before spawning', async () => {
  const ssh = await fakeSsh()
  const server = await makeTestServer({ machines: ssh, filesystemWatch: false })
  onTestFinished(server.cleanup)
  const untrusted = await server.app.handle(
    new Request('http://local/machines/fixture/connect', {
      method: 'POST',
      headers: { origin: 'https://untrusted.example', 'x-client-instance': 'first-tab' },
    }),
  )
  expect(untrusted.status).toBe(403)
  const missing = await server.app.handle(
    new Request('http://local/machines/fixture/connect', {
      method: 'POST',
      headers: { origin: server.origin, 'x-client-instance': 'first-tab' },
    }),
  )
  expect(missing.status).toBe(400)
  expect(await missing.json()).toMatchObject({ error: { code: 'machines.SSH_SETTINGS' } })
  expect(ssh.commands).toHaveLength(0)
})

test('removing machine settings revokes the shared tunnel without a browser subscription', async () => {
  const ssh = await fakeSsh()
  const server = await makeTestServer({ machines: ssh, filesystemWatch: false })
  onTestFinished(server.cleanup)
  const client = createInProcessClient(server)
  const configured = await client.settings.write.post({
    mutationId: 'ssh-api-removal-configure',
    target: 'user',
    operations: [{ kind: 'machine.set', name: 'fixture', machine }],
  })
  expect(configured.error).toBeNull()
  for (const instance of ['first-tab', 'second-tab']) {
    const connected = await client.machines({ name: 'fixture' }).connect.post(undefined, {
      headers: { 'x-client-instance': instance },
    })
    expect(connected.data).toMatchObject({ phase: 'live' })
  }
  const removed = await client.settings.write.post({
    mutationId: 'ssh-api-remove',
    target: 'user',
    operations: [{ kind: 'machine.remove', name: 'fixture' }],
  })
  expect(removed.error).toBeNull()
  await expect.poll(() => ssh.forwardChildren[0]?.signalCode).not.toBeNull()
  await expect(machinesForApp(server.app).resolve('fixture')).rejects.toMatchObject({
    code: 'machines.SSH_SETTINGS',
  })
})

test('serializes authentication prompts and rejects responses from another browser instance', async () => {
  const shown: Array<MachineAuthPrompt | null> = []
  const prompts = new MachinePrompts((_client, prompt) => shown.push(prompt))
  onTestFinished(() => prompts.close())
  const first = prompts.request('first-tab', { name: 'first', prompt: 'Password:', kind: 'secret' })
  const second = prompts.request('first-tab', {
    name: 'second',
    prompt: 'Trust host?',
    kind: 'confirmation',
  })
  const prompt = prompts.current('first-tab')!
  expect(shown).toHaveLength(1)
  expect(() => prompts.respond('second-tab', 'first', prompt.id, 'answer')).toThrow()
  prompts.respond('first-tab', 'first', prompt.id, 'secret-answer')
  expect(await first).toBe('secret-answer')
  const next = prompts.current('first-tab')!
  expect(next.name).toBe('second')
  prompts.respond('first-tab', 'second', next.id, null)
  expect(await second).toBeNull()
  expect(shown.at(-1)).toBeNull()
})
