import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { requireFreePort } from '../ports'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..')
let holder: ReturnType<typeof Bun.spawn> | null = null

afterEach(() => {
  holder?.kill('SIGKILL')
  holder = null
})

async function holdPort(argument: string) {
  const script =
    'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port)'
  const child = Bun.spawn({ cmd: [process.execPath, '-e', script, argument], stdout: 'pipe' })
  holder = child
  const reader = child.stdout.getReader()
  const { value } = await reader.read()
  reader.releaseLock()
  return Number(new TextDecoder().decode(value).trim())
}

test('a port held by a process the desktop did not start is reported and left running', async () => {
  const port = await holdPort(REPO_ROOT)

  const conflict = await requireFreePort('127.0.0.1', port, 'server').catch((error: Error) => error)
  expect(conflict).toMatchObject({
    code: 'desktop.PORT_IN_USE',
    message: expect.stringContaining(`pid ${holder?.pid}`),
  })
  // The holder's arguments stay out of a message that reaches the log and a dialog.
  expect(conflict?.message).not.toContain(REPO_ROOT)
  expect(holder?.exitCode).toBeNull()
  expect(holder?.killed).toBe(false)
})

test('a free port passes', async () => {
  const port = await holdPort('free')
  holder?.kill('SIGKILL')
  await holder?.exited

  await expect(requireFreePort('127.0.0.1', port, 'web')).resolves.toBeUndefined()
})
