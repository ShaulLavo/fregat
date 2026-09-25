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
import { checkpointRefForSessionTurn, orchestrationForApp } from 'server/testing'
import * as v from 'valibot'

import { TurnFiles } from '@/features/chat-mode/components/turn-files'
import { expect, test } from '../../../../../test/fixtures'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { executeDomainGit } from '../../../../../test/factories/session-domain'
import { renderWithProviders } from '../../../../../test/render'

const IDENTITY = ['-c', 'user.email=t@example.com', '-c', 'user.name=T'] as const
const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
const after = before.map((line, index) => (index === 1 || index === 17 ? `${line} changed` : line))
const time = '2026-09-25T00:00:00.000Z'
const files = [{ additions: 2, deletions: 2, kind: 'modified' as const, path: 'app.txt' }]

test('undoes one change of a turn from its row and puts it back', async ({ client, server }) => {
  // The repository exists before the project registers, so its worktree is a git checkout.
  const root = server.root
  const file = join(root, 'app.txt')
  await executeDomainGit(root, 'init', '--quiet')
  await writeFile(file, `${before.join('\n')}\n`)
  await executeDomainGit(root, 'add', 'app.txt')
  await executeDomainGit(root, ...IDENTITY, 'commit', '-qm', 'zero')
  const h = await createRailHarness(client, server, ['Turn session'], '')
  const sessionId = h.sessionIds[0]!
  await executeDomainGit(root, 'update-ref', checkpointRefForSessionTurn(sessionId, 0), 'HEAD')
  await writeFile(file, `${after.join('\n')}\n`)
  await executeDomainGit(root, ...IDENTITY, 'commit', '-qam', 'one')
  const checkpointRef = checkpointRefForSessionTurn(sessionId, 1)
  await executeDomainGit(root, 'update-ref', checkpointRef, 'HEAD')
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

  renderWithProviders(
    <TurnFiles
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
    { application: h.application, command: { bindings: [] } },
  )

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
  await waitFor(() => expect(whole).toBeEnabled())
  await userEvent.click(whole)
  await waitFor(async () => expect(await readFile(file, 'utf8')).toBe(`${before.join('\n')}\n`))
  const reapplyFile = await screen.findByRole('button', { name: 'Reapply every change to app.txt' })
  await waitFor(() => expect(reapplyFile).toBeEnabled())
  await userEvent.click(reapplyFile)
  await waitFor(async () => expect(await readFile(file, 'utf8')).toBe(`${after.join('\n')}\n`))
})
