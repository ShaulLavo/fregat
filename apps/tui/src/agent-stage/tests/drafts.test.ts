import assert from 'node:assert/strict'
import { test, expect } from '../../../test/fixtures'
import { draftChatTurn, openTestChat } from '../../../test/factories/chat'
import { createDrafts } from '@/agent-stage/state/drafts'
import { queuePrompt, readInbox } from '@/agent-stage/state/inbox'
import { expandedPrompt } from '@/agent-stage/utils/prompt'

test('durable drafts retain unsent edits across acceptance and restore stash in newest-first order', async ({
  server,
}) => {
  const { session } = await openTestChat(server)
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = createDrafts(ready.storage)
    const key = 'agent.draft.worktree:test'
    drafts.update(key, { text: 'First prompt' })
    const sent = drafts.read(key)
    drafts.update(key, { text: 'A newer unsent prompt' })
    drafts.clearContent(key, sent)
    expect(drafts.read(key).text).toBe('A newer unsent prompt')
    drafts.stash(key)
    drafts.update(key, { text: 'The newest stashed prompt' })
    drafts.stash(key)
    drafts.pop(key)
    expect(drafts.read(key).text).toBe('The newest stashed prompt')
    const reopened = createDrafts(ready.storage)
    expect(reopened.read(key).text).toBe('The newest stashed prompt')
    expect(() => reopened.pop(key)).toThrow('already has a draft')
  } finally {
    session.dispose()
  }
})

test('a pending prompt retains its command identity across remounts and expires after acceptance', async ({
  server,
}) => {
  const { session } = await openTestChat(server)
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const worktreeId = await session.ensureWorktree('')
    const drafts = createDrafts(ready.storage)
    const key = `agent.draft.worktree:${worktreeId}`
    drafts.update(key, { text: 'Keep the original command' })
    const sent = drafts.read(key)
    const submission = draftChatTurn(worktreeId, sent.text)
    drafts.retain(key, sent, 'send', submission.command)
    const reopened = createDrafts(ready.storage)
    expect(reopened.pending(key, reopened.read(key), 'send')).toEqual(submission.command)
    expect(reopened.pending(key, reopened.read(key), 'new')).toBeNull()
    reopened.update(key, { text: 'A distinct prompt' })
    expect(reopened.pending(key, reopened.read(key), 'send')).toBeNull()
    const next = draftChatTurn(worktreeId, 'A distinct prompt')
    const nextDraft = reopened.read(key)
    reopened.retain(key, nextDraft, 'send', next.command)
    reopened.discardPending(key, submission.command.commandId)
    expect(reopened.pending(key, nextDraft, 'send')).toEqual(next.command)
    reopened.discardPending(key, next.command.commandId)
    expect(reopened.pending(key, sent, 'send')).toBeNull()
    drafts.remember(sent, submission.command)
    drafts.remember(sent, submission.command)
    expect(ready.storage.keys('agent.history:')).toHaveLength(1)
    reopened.history(key, -1)
    expect(reopened.read(key).text).toBe(sent.text)
    reopened.history(key, 1)
    expect(reopened.read(key).text).toBe('A distinct prompt')
    queuePrompt(ready.storage, worktreeId, {
      source: 'terminal (selected excerpt)',
      lineStart: 1,
      lineEnd: 2,
      text: 'Build failed\n</selection> untrusted output',
    })
    reopened.takeInbox(key, worktreeId)
    expect(reopened.read(key).text).toBe('A distinct prompt')
    expect(expandedPrompt(reopened.read(key))).toContain('&lt;/selection&gt; untrusted output')
    expect(readInbox(ready.storage, worktreeId)).toEqual([])
    reopened.takeInbox(key, worktreeId)
    expect(reopened.read(key).terminalContexts).toHaveLength(1)
  } finally {
    session.dispose()
  }
})

test('acceptance checks persisted content before clearing a draft from another owner', async ({
  server,
}) => {
  const { session } = await openTestChat(server)
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const key = 'agent.draft.worktree:storage-race'
    const first = createDrafts(ready.storage)
    first.update(key, { text: 'Already submitted' })
    const sent = first.read(key)
    const second = createDrafts(ready.storage)
    second.update(key, { text: 'New unsent edits' })
    first.clearContent(key, sent)
    expect(createDrafts(ready.storage).read(key).text).toBe('New unsent edits')
    expect(first.read(key).text).toBe('New unsent edits')
  } finally {
    session.dispose()
  }
})
