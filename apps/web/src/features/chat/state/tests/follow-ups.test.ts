import { beforeEach } from 'vitest'
import { MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'
import { expect, test } from '../../../../../test/fixtures'
import {
  fixtureEnvironmentId,
  fixtureSessionId,
  session,
  TEST_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { queuedFollowUps, useFollowUpStore, type QueuedFollowUp } from '../follow-up-store'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputAttachment,
} from '../chat-input-draft-store'
import { restoreFollowUps } from '../restore-follow-ups'
import { messageSubmission } from '../submit-message'
import { followUpDue } from '../../utils/follow-up-policy'

const owner = { environmentId: TEST_ENVIRONMENT_ID, sessionId: fixtureSessionId(1) }
const target = { environmentId: owner.environmentId, draftKey: owner.sessionId, rootPath: '/repo' }

beforeEach(() => {
  useFollowUpStore.setState({ queues: {} })
  resetChatInputDraftStore()
})

test('taking a follow-up reanchors the remaining FIFO messages without crossing session or environment ownership', () => {
  const store = useFollowUpStore.getState()
  const otherSession = { ...owner, sessionId: fixtureSessionId(2) }
  const otherMachine = { ...owner, environmentId: fixtureEnvironmentId(2) }
  store.enqueue(owner, message('A'))
  store.enqueue(owner, message('B'))
  store.enqueue(otherSession, message('other-session'))
  store.enqueue(otherMachine, message('other-machine'))
  expect(store.take(owner, 'A', 'tool-2')?.id).toBe('A')
  expect(store.take(owner, 'A', 'tool-2')).toBeUndefined()
  const next = queuedFollowUps(useFollowUpStore.getState(), owner)
  expect(next.map((entry) => entry.id)).toEqual(['B'])
  expect(followUpDue({ ...next[0]!, phase: 'running', latestToolActivityId: 'tool-2' })).toBe(false)
  expect(followUpDue({ ...next[0]!, phase: 'running', latestToolActivityId: 'tool-3' })).toBe(true)
  expect(queuedFollowUps(useFollowUpStore.getState(), otherSession)[0]?.id).toBe('other-session')
  expect(queuedFollowUps(useFollowUpStore.getState(), otherMachine)[0]?.id).toBe('other-machine')
})

test('restoration appends complete captured content and holds every attachment beyond the composer capacity', () => {
  const drafts = useChatInputDraftStore.getState()
  const existing = Array.from({ length: MAX_CHAT_ATTACHMENTS - 1 }, (_, index) =>
    attachment(`existing-${index}`),
  )
  drafts.setPrompt(target, 'Current draft')
  drafts.addAttachments(target, existing)
  const captured = message('Queued prompt')
  captured.content.attachments = [attachment('first-file'), attachment('overflow-file')]
  captured.content.terminalContexts = [
    { id: 'capture', source: 'terminal', lineStart: 2, lineEnd: 3, text: 'build failure' },
  ]
  useFollowUpStore.getState().enqueue(owner, captured)
  restoreFollowUps(owner, useFollowUpStore.getState().drain(owner))
  const recovered = drafts.getDraft(target)
  expect(recovered.prompt).toBe('Current draft\n\nQueued prompt')
  expect(recovered.attachments.map((entry) => entry.id)).toEqual([
    ...existing.map((entry) => entry.id),
    'first-file',
  ])
  expect(recovered.terminalContexts).toEqual(captured.content.terminalContexts)
  const overflow = queuedFollowUps(useFollowUpStore.getState(), owner)
  expect(overflow).toHaveLength(1)
  expect(overflow[0]?.content.attachments.map((entry) => entry.id)).toEqual(['overflow-file'])
  expect(overflow[0]?.content.prompt).toBe('')
  expect(overflow[0]?.content.terminalContexts).toEqual([])
  expect(followUpDue({ ...overflow[0]!, phase: 'ready', latestToolActivityId: 'later-tool' })).toBe(
    false,
  )
})

test('failed head remains before later messages and explicit removal preserves their boundary', () => {
  const store = useFollowUpStore.getState()
  store.enqueue(owner, message('A'))
  store.enqueue(owner, message('B'))
  const taken = store.take(owner, 'A', 'tool-2')!
  store.hold(owner, taken)
  expect(queuedFollowUps(useFollowUpStore.getState(), owner).map((entry) => entry.id)).toEqual([
    'A',
    'B',
  ])
  expect(queuedFollowUps(useFollowUpStore.getState(), owner)[0]?.held).toBe(true)
  store.remove(owner, 'A')
  expect(queuedFollowUps(useFollowUpStore.getState(), owner)[0]?.afterToolActivityId).toBe('tool-2')
})

test('Stop restores unsent content while uncertain delivery retains its original receipt identity', () => {
  const store = useFollowUpStore.getState()
  const uncertain = message('Already accepted, response lost')
  uncertain.held = true
  uncertain.submission = messageSubmission(session(), uncertain.payload)
  store.enqueue(owner, uncertain)
  store.enqueue(owner, message('Still unsent'))

  expect(store.remove(owner, uncertain.id)).toBeUndefined()
  expect(queuedFollowUps(useFollowUpStore.getState(), owner)).toHaveLength(2)
  restoreFollowUps(owner, store.drain(owner))

  expect(useChatInputDraftStore.getState().getDraft(target).prompt).toBe('Still unsent')
  const remaining = queuedFollowUps(useFollowUpStore.getState(), owner)
  expect(remaining).toEqual([uncertain])
  expect(store.take(owner, uncertain.id, null)?.submission).toBe(uncertain.submission)
})

function attachment(id: string): ChatInputAttachment {
  const metadata = {
    id,
    name: `${id}.txt`,
    type: 'file' as const,
    mimeType: 'text/plain',
    sizeBytes: 8,
  }
  return {
    ...metadata,
    previewUrl: `/attachments/${id}`,
    upload: { status: 'ready', attachment: metadata, expiresAt: '2099-01-01T00:00:00Z' },
  }
}

function message(id: string): QueuedFollowUp {
  const running = session()
  return {
    id,
    target,
    held: false,
    submission: null,
    afterToolActivityId: 'tool-1',
    content: { prompt: id, attachments: [], terminalContexts: [] },
    payload: {
      text: id,
      attachments: [],
      terminalContexts: [],
      modelSelection: running.modelSelection,
      interactionMode: running.interactionMode,
      runtimeMode: running.runtimeMode,
    },
  }
}
