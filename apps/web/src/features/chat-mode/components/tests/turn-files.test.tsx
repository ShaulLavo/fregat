import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  commandIdSchema,
  messageIdSchema,
  orchestrationCommandSchema,
  turnIdSchema,
} from '@workspace/contracts'
import { checkpointRefForSessionTurn, orchestrationForApp, runGit } from 'server/testing'
import * as v from 'valibot'

import { TurnFiles } from '@/features/chat-mode/components/turn-files'
import { expect, test } from '../../../../../test/fixtures'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { createObservedInProcessClient } from '../../../../../test/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { activeServerOrigin } from '@/lib/client'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

const IDENTITY: readonly string[] = ['-c', 'user.email=t@example.com', '-c', 'user.name=T']
const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
const after = before.map((line, index) => (index === 1 || index === 17 ? `${line} changed` : line))
const time = '2026-09-25T00:00:00.000Z'
const files = [{ additions: 2, deletions: 2, kind: 'modified' as const, path: 'app.txt' }]

test('undoes and reapplies changes, then retains the turn until an empty session is ready', async ({
  client,
  server,
}) => {
  // The repository exists before the project registers, so its worktree is a git checkout.
  const root = server.root
  const file = join(root, 'app.txt')
  await runGit(root, ['init', '--quiet'], { cwdMode: 'option' })
  await writeFile(file, `${before.join('\n')}\n`)
  await runGit(root, ['add', 'app.txt'], { cwdMode: 'option' })
  await runGit(root, IDENTITY.concat(['commit', '-qm', 'zero']), { cwdMode: 'option' })
  const h = await createRailHarness(client, server, ['Turn session', 'Empty session'], '')
  const sessionId = h.sessionIds[0]!
  await runGit(root, ['update-ref', checkpointRefForSessionTurn(sessionId, 0), 'HEAD'], {
    cwdMode: 'option',
  })
  await writeFile(file, `${after.join('\n')}\n`)
  await runGit(root, IDENTITY.concat(['commit', '-qam', 'one']), { cwdMode: 'option' })
  const checkpointRef = checkpointRefForSessionTurn(sessionId, 1)
  await runGit(root, ['update-ref', checkpointRef, 'HEAD'], { cwdMode: 'option' })
  await orchestrationForApp(server.app).dispatch(
    v.parse(orchestrationCommandSchema, {
      assistantMessageId: v.parse(messageIdSchema, 'message-1'),
      checkpointRef,
      checkpointTurnCount: 1,
      commandId: v.parse(commandIdSchema, 'turn-one-checkpoint'),
      completedAt: time,
      createdAt: time,
      files,
      sessionId,
      status: 'ready',
      turnId: v.parse(turnIdSchema, 'turn-one'),
      type: 'session.turn.diff.complete',
    }),
  )

  const emptySessionId = h.sessionIds[1]!
  const firstLoad = Promise.withResolvers<void>()
  const barrier = Promise.withResolvers<void>()
  const queryClient = createTestQueryClient()
  const observed = createObservedInProcessClient(server, async (request) => {
    const url = new URL(request.url)
    if (url.pathname !== '/orchestration/turn-diff') return
    if (url.searchParams.get('sessionId') === sessionId) await firstLoad.promise
    if (url.searchParams.get('sessionId') === emptySessionId) await barrier.promise
  })
  registerEnvironmentQueryClient(queryClient, activeServerOrigin(), observed)
  const rendered = renderWithProviders(
    <TurnFiles
      rootPath=''
      summary={{
        assistantMessageId: null,
        checkpointRef,
        checkpointTurnCount: 1,
        completedAt: time,
        files,
        sessionId,
        status: 'ready',
        turnId: v.parse(turnIdSchema, 'turn-one'),
      }}
      onOpenFile={() => {}}
    />,
    { application: h.application, command: { bindings: [] }, queryClient },
  )

  try {
    await screen.findByRole('status', { name: 'Loading turn changes' })
    expect(screen.queryByText(/0 changes/)).toBeNull()
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0)
  } finally {
    firstLoad.resolve()
  }

  const hunks = await screen.findAllByRole('treeitem', { name: /line 2|line 18/ })
  expect(hunks).toHaveLength(2)
  const [first] = hunks
  const undo = within(first!).getByRole('button', { name: 'Undo' })
  await waitFor(() => expect(undo).toBeEnabled())
  const tree = screen.getByRole('tree', { name: 'Turn changed files' })
  tree.focus()
  await userEvent.keyboard('{Home}{ArrowDown}')
  const event = new KeyboardEvent('keydown', {
    key: 'Backspace',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    tree.dispatchEvent(event)
  })
  expect(event.defaultPrevented).toBe(false)
  await userEvent.click(undo)

  await waitFor(async () => expect((await readFile(file, 'utf8')).split('\n')[1]).toBe('line 2'))
  const reapply = await within(first!).findByRole('button', { name: 'Reapply' })
  expect(within(first!).getByText('Undone')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Undo every change to app.txt' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.click(reapply)
  await waitFor(async () => expect(await readFile(file, 'utf8')).toBe(`${after.join('\n')}\n`))
  const whole = screen.getByRole('button', { name: 'Undo every change to app.txt' })
  await waitFor(() => expect(whole).toHaveAttribute('aria-disabled', 'false'))
  await userEvent.click(whole)
  await waitFor(async () => expect(await readFile(file, 'utf8')).toBe(`${before.join('\n')}\n`))
  const reapplyFile = await screen.findByRole('button', { name: 'Reapply every change to app.txt' })
  await waitFor(() => expect(reapplyFile).toHaveAttribute('aria-disabled', 'false'))
  await userEvent.click(reapplyFile)
  await waitFor(async () => expect(await readFile(file, 'utf8')).toBe(`${after.join('\n')}\n`))

  await runGit(root, ['update-ref', checkpointRefForSessionTurn(emptySessionId, 0), 'HEAD'], {
    cwdMode: 'option',
  })
  const nextRef = checkpointRefForSessionTurn(emptySessionId, 1)
  await runGit(root, ['update-ref', nextRef, 'HEAD'], { cwdMode: 'option' })
  const nextSummary = {
    assistantMessageId: null,
    checkpointRef: nextRef,
    checkpointTurnCount: 1,
    completedAt: time,
    files: [],
    sessionId: emptySessionId,
    status: 'ready' as const,
    turnId: v.parse(turnIdSchema, 'turn-two'),
  }
  await orchestrationForApp(server.app).dispatch(
    v.parse(orchestrationCommandSchema, {
      ...nextSummary,
      assistantMessageId: v.parse(messageIdSchema, 'message-2'),
      commandId: v.parse(commandIdSchema, 'turn-two-checkpoint'),
      createdAt: time,
      type: 'session.turn.diff.complete',
    }),
  )
  try {
    rendered.rerender(<TurnFiles rootPath='' summary={nextSummary} onOpenFile={() => {}} />)
    expect(screen.getByText('Turn 1 · 1 files · 2 changes')).toBeVisible()
    expect(screen.getAllByRole('treeitem', { name: /line 2|line 18/ })).toHaveLength(2)
    expect(screen.getByRole('status', { name: 'Loading turn changes' })).toBeVisible()
    expect(screen.queryByText(/0 changes/)).toBeNull()
    await act(async () => {
      barrier.resolve()
    })
    await screen.findByText('Turn 1 · 0 files · 0 changes')
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0)
    rendered.rerender(
      <TurnFiles
        rootPath=''
        summary={{ ...nextSummary, checkpointTurnCount: 3 }}
        onOpenFile={() => {}}
      />,
    )
    await screen.findByText('Could not load turn changes')
    expect(screen.queryByText(/0 changes/)).toBeNull()
  } finally {
    barrier.resolve()
    rendered.unmount()
  }
})
