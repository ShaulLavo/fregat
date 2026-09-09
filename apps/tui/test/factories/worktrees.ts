import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { act } from 'react'
import * as v from 'valibot'
import { ScrollBoxRenderable, SelectRenderable } from '@opentui/core'
import { commandIdSchema, worktreeIdSchema } from '@workspace/contracts'
import {
  createDraftSessionSubmission,
  createSessionDeleteCommand,
} from '@workspace/client-core/chat/commands'
import { orchestrationForApp } from 'server/testing'
import { openTestChat } from './chat'
import { prepareGitWorkbench, gitCommand } from './git-workbench'
import type { TestServer } from '../server'
import type { renderTui } from '../render'

export async function openManagedTestChat(server: TestServer) {
  const repository = `${server.root}/main`
  await mkdir(repository)
  await prepareGitWorkbench(repository)
  await writeFile(`${repository}/.gitignore`, 'ignored.txt\n')
  await gitCommand(repository, 'add', '.gitignore')
  await gitCommand(repository, 'commit', '-qm', 'Ignore generated files')
  const { session, chat } = await openTestChat(server)
  const baseId = await session.ensureWorktree('main')
  const worktreeId = v.parse(worktreeIdSchema, crypto.randomUUID())
  const submission = createDraftSessionSubmission({
    createdAt: new Date().toISOString(),
    text: 'Use this checkout',
    modelSelection: { providerInstanceId: server.providerAdapter.adapterKey, model: 'mock-model' },
    worktreeTarget: { kind: 'new', worktreeId, baseWorktreeId: baseId },
  })
  await chat.dispatch(submission.command)
  const engine = orchestrationForApp(server.app)
  assert(engine)
  await engine.providerRuntimeIdle()
  await chat.dispatch(createSessionDeleteCommand({ sessionId: submission.command.sessionId }))
  await engine.providerRuntimeIdle()
  await chat.refresh()
  const base = chat.getSnapshot().projection.worktreeById[baseId]
  const worktree = chat.getSnapshot().projection.worktreeById[worktreeId]
  assert(base && worktree)
  return {
    session,
    chat,
    base,
    worktree,
    repository,
    async cleanupRequest() {
      await chat.dispatch({
        type: 'worktree.cleanup',
        commandId: v.parse(commandIdSchema, crypto.randomUUID()),
        worktreeId,
      })
      await engine.providerRuntimeIdle()
      await chat.refresh()
    },
  }
}

export async function chooseWorktreeOption(
  frame: Awaited<ReturnType<typeof renderTui>>,
  name: string,
) {
  const select = frame.renderer.currentFocusedRenderable
  assert(select instanceof SelectRenderable)
  const index = select.options.findIndex((option) => option.name.includes(name))
  assert(index >= 0, `Missing native option: ${name}`)
  await act(async () => {
    const distance = index - select.getSelectedIndex()
    for (let offset = 0; offset < Math.abs(distance); offset += 1)
      frame.mockInput.pressArrow(distance < 0 ? 'up' : 'down')
    frame.mockInput.pressEnter()
  })
}

export async function readWorktreeDescription(frame: Awaited<ReturnType<typeof renderTui>>) {
  const scroll = frame.renderer.root.findDescendantById('worktree-description')
  assert(scroll instanceof ScrollBoxRenderable)
  const rows = new Map<number, string>()
  const frames: string[] = []
  for (let page = 0; page < scroll.scrollHeight; page += 1) {
    await act(async () => frame.renderOnce())
    const screen = frame.captureCharFrame()
    frames.push(screen)
    const lines = screen.split('\n')
    const viewport = scroll.viewport
    for (let offset = 0; offset < viewport.height; offset += 1)
      rows.set(
        scroll.scrollTop + offset,
        lines[viewport.y + offset].slice(viewport.x, viewport.x + viewport.width).trimEnd(),
      )
    if (scroll.scrollTop + viewport.height >= scroll.scrollHeight) break
    await act(async () => frame.mockInput.pressKey('\u001b[6~'))
  }
  return { text: [...rows.values()].join('').replaceAll(/\s/g, ''), frames }
}
