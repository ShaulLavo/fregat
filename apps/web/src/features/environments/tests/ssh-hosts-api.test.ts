import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { writeSshConfig } from '../../../../test/factories/ssh-config'
import { expect, test } from '../../../../test/fixtures'

test('lists configured SSH aliases from the primary backend and picks up config edits', async ({
  server,
  client,
}) => {
  await writeSshConfig(
    server.root,
    'Host Work_Box dev.example *.internal !excluded\nHostName ignored\nHost Work_Box',
  )
  const first = await client.machines['ssh-hosts'].get()
  expect(first.error).toBeNull()
  expect(first.data).toEqual({ hosts: ['Work_Box', 'dev.example'] })
  await writeSshConfig(server.root, 'Host replacement')
  const second = await client.machines['ssh-hosts'].get()
  expect(second.data).toEqual({ hosts: ['replacement'] })
})

test('returns an empty list when SSH configuration is absent', async ({ client }) => {
  const result = await client.machines['ssh-hosts'].get()
  expect(result.error).toBeNull()
  expect(result.data).toEqual({ hosts: [] })
})

test('reports malformed configuration instead of claiming there are no SSH hosts', async ({
  server,
  client,
}) => {
  await writeSshConfig(server.root, 'Host "unclosed')
  const result = await client.machines['ssh-hosts'].get()
  expect(result.status).toBe(500)
  expect(result.error?.value).toMatchObject({ error: { code: 'machines.SSH_DISCOVERY' } })
})

test('reports unreadable configuration instead of claiming there are no SSH hosts', async ({
  server,
  client,
}) => {
  await mkdir(path.join(server.root, '.ssh/config'), { recursive: true })
  const result = await client.machines['ssh-hosts'].get()
  expect(result.status).toBe(500)
  expect(result.error?.value).toMatchObject({ error: { code: 'machines.SSH_DISCOVERY' } })
})

test('refuses SSH enumeration from an untrusted browser origin', async ({ server }) => {
  await writeSshConfig(server.root, 'Host private-host')
  const response = await server.app.handle(
    new Request('http://local/machines/ssh-hosts', {
      headers: { origin: 'https://untrusted.example' },
    }),
  )
  expect(response.status).toBe(403)
})
