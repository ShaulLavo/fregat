import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { Application } from '@/components/application'
import { openTestChat } from './chat'
import { createControlledInProcessTransport } from '../client'
import { renderTui } from '../render'
import type { TestServer } from '../server'

export async function renderAgentNavigation(
  server: TestServer,
  {
    width = 132,
    rootPath = 'nested/project',
  }: { readonly width?: number; readonly rootPath?: string } = {},
) {
  await mkdir(`${server.root}/${rootPath}`, { recursive: true })
  await writeFile(`${server.root}/${rootPath}/inside-project.txt`, 'Inside the selected project.')
  await writeFile(`${server.root}/outside-project.txt`, 'Outside the selected project.')
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const { session, chat } = await openTestChat(server, {
    client,
    createSocket: transport.createSocket,
  })
  const worktreeId = await session.ensureWorktree(rootPath)
  await chat.refresh()
  const worktree = chat.getSnapshot().projection.worktreeById[worktreeId]
  assert(worktree)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const frame = await renderTui(
    <Application
      session={session}
      noColor
      onExit={() => {}}
      initialLocation={{ kind: 'agent', projectId: worktree.projectId, sessionId: null }}
    />,
    { width, height: 38, useThread: false, kittyKeyboard: true },
  )
  return {
    frame,
    session,
    ready,
    transport,
    worktreeId,
    rootPath,
    async cleanup() {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    },
  }
}
