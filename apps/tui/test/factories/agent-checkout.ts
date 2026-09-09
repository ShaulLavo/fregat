import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { openTestChat } from './chat'
import { prepareGitWorkbench, gitCommand } from './git-workbench'
import type { TestServer } from '../server'

export async function openLinkedTestChat(server: TestServer) {
  await mkdir(`${server.root}/main`)
  await prepareGitWorkbench(`${server.root}/main`)
  await gitCommand(
    `${server.root}/main`,
    'worktree',
    'add',
    '-b',
    'session-linked',
    `${server.root}/linked`,
  )
  const { session, chat } = await openTestChat(server)
  const mainId = await session.ensureWorktree('main')
  const linkedId = await session.ensureWorktree('linked')
  await chat.refresh()
  const main = chat.getSnapshot().projection.worktreeById[mainId]
  const linked = chat.getSnapshot().projection.worktreeById[linkedId]
  assert(main && linked)
  return { session, chat, main, linked }
}
