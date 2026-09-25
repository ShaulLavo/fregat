import { writeFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

import { createTestTerminalHost } from '../../../test/factories/terminal-host'
import { RING_BYTES } from '../protocol'

const hosts: Awaited<ReturnType<typeof createTestTerminalHost>>[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
})

async function testHost() {
  const host = await createTestTerminalHost()
  hosts.push(host)
  return host
}

const LOOP = [
  '/bin/sh',
  '-c',
  'i=0; while :; do i=$((i+1)); echo "tick $i"; sleep 0.05; done',
] as const

it('keeps a shell running across a client reconnect, with contiguous offsets and the same pid', async () => {
  const host = await testHost()
  const received: { offset: number; length: number }[] = []
  const first = await host.client.spawn({
    key: 'loop',
    command: LOOP,
    onData: (bytes) => received.push({ offset: 0, length: bytes.byteLength }),
  })
  await expect.poll(() => received.length).toBeGreaterThan(2)
  const resumeAt = first.offset
  host.client.close()

  const chunks: { offset: number; length: number }[] = []
  const again = await host.connect().attach({
    key: 'loop',
    from: resumeAt,
    onData: (bytes, offset) => chunks.push({ offset, length: bytes.byteLength }),
  })

  expect(again.pid).toBe(first.pid)
  await expect.poll(() => chunks.length).toBeGreaterThan(2)
  expect(chunks[0]?.offset).toBe(resumeAt)
  for (let index = 1; index < chunks.length; index++) {
    const previous = chunks[index - 1]!
    expect(chunks[index]?.offset).toBe(previous.offset + previous.length)
  }
})

it('reports one gap when the ring dropped output while no client was attached', async () => {
  const host = await testHost()
  // Well past the ring while detached: 3 MiB of output.
  const burst = [
    '/bin/sh',
    '-c',
    'sleep 0.3; head -c 3145728 /dev/zero | tr "\\0" x; sleep 30',
  ] as const
  await host.client.spawn({ key: 'burst', command: burst, onData: () => {} })
  host.client.close()
  await Bun.sleep(1_500)

  const gaps: { from: number; to: number }[] = []
  const pty = await host.connect().attach({
    key: 'burst',
    from: 0,
    onData: () => {},
    onGap: (from, to) => gaps.push({ from, to }),
  })

  await expect.poll(() => pty.offset).toBeGreaterThanOrEqual(3 * 1024 * 1024)
  expect(gaps).toHaveLength(1)
  expect(gaps[0]?.from).toBe(0)
  expect(gaps[0]!.to).toBeGreaterThanOrEqual(3 * 1024 * 1024 - RING_BYTES)
})

it('refuses a client that holds a different token', async () => {
  const host = await testHost()
  await host.client.host()
  host.client.close()
  writeFileSync(host.paths.token, 'not-the-host-token')

  await expect(host.connect().host()).rejects.toMatchObject({ code: 'terminal.HOST_REFUSED' })
})
