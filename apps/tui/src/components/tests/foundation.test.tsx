import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'

import { Application } from '@/components/application'
import { recentCommands } from '@/storage/recent-commands-policy'
import { createControlledInProcessTransport } from '../../../test/client'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test('palette commands restore input focus and persist successful command history', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await renderTui(<Application session={session} onExit={() => {}} noColor />, {
    width: 110,
    height: 32,
    useThread: false,
    kittyKeyboard: true,
  })
  try {
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    await act(async () => {
      await frame.mockInput.typeText('Open settings')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Open settings')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await frame.mockInput.typeText('colorTheme')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('1 setting')
    const state = session.getSnapshot()
    expect(state.kind).toBe('ready')
    if (state.kind !== 'ready') return
    expect(recentCommands.read(state.storage)).toContain('workspace.showSettings')
    await state.storage.flush()
  } finally {
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})

test('a disconnected file preview is cancelled and cannot display a late response', async ({
  server,
}) => {
  await writeFile(`${server.root}/example.txt`, 'PRIVATE LATE FILE PREVIEW')
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const session = createTestSettingsSession(server, {
    client,
    createSocket: transport.createSocket,
  })
  await session.refresh()
  const frame = await renderTui(<Application session={session} onExit={() => {}} noColor />, {
    width: 110,
    height: 32,
    useThread: false,
    kittyKeyboard: true,
  })
  const gate = transport.pauseNextResponse('/fs/read')
  try {
    await act(async () => {
      frame.mockInput.pressKey('p', { ctrl: true })
    })
    await act(async () => {
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return frame.captureCharFrame()
        })
        .toContain('example.txt')
      await frame.mockInput.typeText('example.txt')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('▶ example.txt')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(() =>
        transport.requests.some((request) => new URL(request.url).pathname === '/fs/read'),
      )
      .toBe(true)
    const paused = await gate.reached
    await act(async () => {
      transport.sockets[0].serverClose({ code: 1006, wasClean: false })
    })
    expect(paused.signal.aborted).toBe(true)
    gate.release()
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Disconnected')
    expect(frame.captureCharFrame()).not.toContain('PRIVATE LATE FILE PREVIEW')
    expect(frame.captureCharFrame()).not.toContain('Filter files')
    await act(async () => {
      frame.mockInput.pressKey('p', { ctrl: true })
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).not.toContain('Filter files')
  } finally {
    gate.release()
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})
