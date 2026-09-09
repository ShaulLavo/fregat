import assert from 'node:assert/strict'
import { act } from 'react'
import * as v from 'valibot'
import { worktreeIdSchema } from '@workspace/contracts'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { registerWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { Application } from '@/components/application'
import { rememberedWorkbench } from '@/workbench/utils/location'
import { rememberAgent, rememberedAgent } from '@/agent/utils/location'
import { selectedWorktree, stageTarget } from '@/agent/utils/selection'
import { agentAddress, resolveAddress } from '@/navigation/utils/address'
import { createHistory } from '@/navigation/state/history'
import { test, expect } from '../../../test/fixtures'
import { draftChatTurn } from '../../../test/factories/chat'
import { openLinkedTestChat } from '../../../test/factories/agent-checkout'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

test('opening the selected linked-worktree session keeps that checkout', async ({
  server,
  client,
}) => {
  const { session, chat, main, linked } = await openLinkedTestChat(server)
  expect(linked.projectId).toBe(main.projectId)
  expect(main.kind).toBe('current')
  expect(linked.kind).toBe('linked')
  const submission = draftChatTurn(linked.id)
  await chat.dispatch(submission.command)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const address = await agentAddress(
    ready.descriptor.environmentId,
    { kind: 'agent', projectId: linked.projectId, sessionId: submission.command.sessionId },
    { client, signal: session.signal },
    chat.getSnapshot().projection,
  )
  expect(parseAddress(address).workspace).toBe(
    workspaceToken(
      await registerWorkspaceAddress({ client, signal: session.signal, path: 'linked' }),
    ),
  )
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: linked.projectId,
        sessionId: submission.command.sessionId,
      }}
    />,
    { width: 132, height: 38, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    expect(
      chat.getSnapshot().projection.sessionById[submission.command.sessionId]?.worktreeId,
    ).toBe(linked.id)
    await runPaletteCommand(frame, 'workspace.openWorkbench')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-file-tree')
    const state = session.getSnapshot()
    assert(state.kind === 'ready')
    expect(rememberedWorkbench(state.storage)?.rootPath).toBe('linked')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})

test('linked-checkout drafts survive addresses, history, settings, and opening the workbench', async ({
  server,
  client,
}) => {
  const { session, chat, main, linked } = await openLinkedTestChat(server)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const location = {
    kind: 'agent',
    projectId: linked.projectId,
    sessionId: null,
    worktreeId: linked.id,
  } as const
  const projection = chat.getSnapshot().projection
  expect(selectedWorktree(projection, location)?.id).toBe(linked.id)
  expect(stageTarget(projection, location)).toEqual({ kind: 'draft', worktreeId: linked.id })
  const address = await agentAddress(
    ready.descriptor.environmentId,
    location,
    { client, signal: session.signal },
    projection,
  )
  expect(
    await resolveAddress(address, client, ready.descriptor.environmentId, session.signal),
  ).toEqual(location)
  rememberAgent(ready.storage, location)
  expect(rememberedAgent(ready.storage)).toEqual(location)
  const history = createHistory({ ...location, worktreeId: main.id })
  history.visit(location)
  expect(history.go(-1)).toMatchObject({ worktreeId: main.id })
  expect(history.go(1)).toEqual(location)

  const frame = await renderTui(
    <Application session={session} onExit={() => {}} noColor initialLocation={location} />,
    { width: 132, height: 38, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => frame.mockInput.typeText('Keep the linked checkout'))
    await runPaletteCommand(frame, 'Open settings')
    await runPaletteCommand(frame, 'Show chat')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Keep the linked checkout')
    expect(rememberedAgent(ready.storage)).toEqual(location)
    await runPaletteCommand(frame, 'workspace.openWorkbench')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-file-tree')
    expect(rememberedWorkbench(ready.storage)?.rootPath).toBe('linked')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})

test('an unavailable explicit checkout cannot silently become the current checkout', async ({
  server,
  client,
}) => {
  const { session, chat, main } = await openLinkedTestChat(server)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const location = {
    kind: 'agent',
    projectId: main.projectId,
    sessionId: null,
    worktreeId: v.parse(worktreeIdSchema, '11111111-1111-4111-8111-111111111111'),
  } as const
  const projection = chat.getSnapshot().projection
  expect(selectedWorktree(projection, location)).toBeNull()
  expect(stageTarget(projection, location)).toBeNull()
  await expect(
    agentAddress(
      ready.descriptor.environmentId,
      location,
      { client, signal: session.signal },
      projection,
    ),
  ).rejects.toThrow('This checkout is unavailable.')
  const frame = await renderTui(
    <Application session={session} onExit={() => {}} noColor initialLocation={location} />,
    { width: 132, height: 38, useThread: false, kittyKeyboard: true },
  )
  try {
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Checkout unavailable')
    expect(frame.renderer.currentFocusedRenderable?.id).not.toBe('agent-composer')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
