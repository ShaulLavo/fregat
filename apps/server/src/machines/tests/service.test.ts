import { expect, test } from 'vitest'
import { machine, sshServiceFixture } from '../../../test/factories/ssh'

test('disconnect cancels a connect that is still preparing its machine entry', async () => {
  const { service, commands } = await sshServiceFixture()
  const connection = service.connect('fixture', 'tab-one')
  const disconnection = service.disconnect('fixture', 'tab-one')
  const [state] = await Promise.all([connection, disconnection])
  expect(state.phase).toBe('idle')
  expect(commands).toHaveLength(0)
})

test('a reconnect waits for pending disconnect cleanup before launching again', async () => {
  const { service, commands } = await sshServiceFixture({ slowProbe: true })
  const first = service.connect('fixture', 'tab-one')
  await expect.poll(() => commands.length).toBe(1)
  const disconnect = service.disconnect('fixture', 'tab-one')
  await Bun.sleep(0)
  const reconnect = service.connect('fixture', 'tab-one')
  const [cancelled, , resumed] = await Promise.all([first, disconnect, reconnect])
  expect(cancelled.phase).not.toBe('live')
  expect(resumed.phase).toBe('live')
  expect(await service.resolve('fixture')).toMatchObject({ origin: 'http://127.0.0.1:51078' })
})

test('the shared forward stays live until the last tab disconnects', async () => {
  const { service, commands } = await sshServiceFixture()
  const connections = await Promise.all([
    service.connect('fixture', 'tab-one'),
    service.connect('fixture', 'tab-two'),
  ])
  expect(connections.every((state) => state.phase === 'live')).toBe(true)
  expect(commands).toHaveLength(3)
  await service.disconnect('fixture', 'tab-one')
  expect(await service.resolve('fixture')).toMatchObject({ origin: 'http://127.0.0.1:51078' })
  expect(commands).toHaveLength(3)
  await service.disconnect('fixture', 'tab-two')
  await expect(service.resolve('fixture')).rejects.toMatchObject({ code: 'machines.SSH_FORWARD' })
  expect(commands).toHaveLength(4)
})

test('changing an SSH target cancels its pending launch and connects the updated machine', async () => {
  const { service, commands, setMachines } = await sshServiceFixture({ slowProbe: true })
  const first = service.connect('fixture', 'tab-one')
  await expect.poll(() => commands.length).toBe(1)
  setMachines({ fixture: { ...machine, target: 'updated-fixture' } })
  const updated = service.connect('fixture', 'tab-two')
  const [previous, current] = await Promise.all([first, updated])
  expect(previous.phase).not.toBe('live')
  expect(current.phase).toBe('live')
  expect(commands.at(-1)?.at(-1)).toBe('updated-fixture')
  await service.disconnect('fixture', 'tab-two')
  expect(await service.resolve('fixture')).toMatchObject({ origin: 'http://127.0.0.1:51078' })
})
