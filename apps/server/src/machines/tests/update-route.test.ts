import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import {
  localSsh,
  shippableRelease,
  updateFixture,
} from '../../../test/factories/remote-server-update'
import { machine } from '../../../test/factories/ssh'

const origin = 'http://localhost:5173'

afterEach(closeTestApps)

async function appWithMachine() {
  const { root, home, local } = await updateFixture()
  const settings = testSettingsOptions(root)
  await mkdir(path.dirname(settings.userFilePath!), { recursive: true })
  await writeFile(
    settings.userFilePath!,
    JSON.stringify({ 'environments.machines': { fixture: machine } }),
  )
  const ssh = localSsh({ home })
  const app = createTestApp({
    auth: { allowedOrigins: [origin] },
    settings,
    watch: false,
    workspaceRoot: root,
    webOrigin: origin,
    machines: { ...ssh, releaseSource: await shippableRelease(local, 'first') },
  })
  return { app, ssh }
}

function update(app: ReturnType<typeof createTestApp>, name: string) {
  return app.handle(
    new Request(`http://local/machines/${name}/update`, {
      method: 'POST',
      headers: { origin, 'x-client-instance': 'update-route-test' },
    }),
  )
}

test('the update route installs, restarts and connects a configured machine', async () => {
  const { app } = await appWithMachine()
  const response = await update(app, 'fixture')
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    name: 'fixture',
    phase: 'live',
    origin: '/machines/fixture/proxy',
    descriptor: { serverVersion: 'first' },
  })
})

test.for(['elsewhere', 'fixture%20', '..%2Ffixture'])(
  'the update route refuses %s before running anything',
  async (name) => {
    const { app, ssh } = await appWithMachine()
    const response = await update(app, name)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'machines.SSH_SETTINGS' } })
    expect(ssh.commands).toEqual([])
  },
)

test('two clients updating one machine share a single update', async () => {
  const { app, ssh } = await appWithMachine()
  const responses = await Promise.all([update(app, 'fixture'), update(app, 'fixture')])
  const states = await Promise.all(responses.map((response) => response.json()))
  expect(states.map((state) => state.phase)).toEqual(['live', 'live'])
  expect(ssh.commands.filter((command) => command.includes('present=')).length).toBe(2)
})
