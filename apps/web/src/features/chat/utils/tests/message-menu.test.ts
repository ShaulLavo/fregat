import { chatMessageMenu, type ChatMessageMenuContext } from '@/features/chat/utils/message-menu'
import { expect, test } from '../../../../../test/fixtures'

test('a user message offers Copy without the markdown twin', () => {
  expect(itemLabels(menuContext(), 'copy')).toEqual(['Copy'])
})

test('an assistant message offers both copy flavours in order', () => {
  expect(itemLabels(menuContext({ isAssistant: true }), 'copy')).toEqual([
    'Copy',
    'Copy as Markdown',
  ])
})

test('an empty message disables both copy items rather than hiding them', () => {
  const items = sectionItems(menuContext({ hasText: false, isAssistant: true }), 'copy')

  expect(items.map((item) => item.disabled)).toEqual([true, true])
})

test('Copy runs the plain-text copy and Copy as Markdown runs the source copy', () => {
  const ran: string[] = []
  const items = sectionItems(
    menuContext({
      copyMarkdown: () => ran.push('markdown'),
      copyText: () => ran.push('text'),
      isAssistant: true,
    }),
    'copy',
  )

  for (const item of items) item.run()

  expect(ran).toEqual(['text', 'markdown'])
})

test('every message offers the whole conversation as Markdown', () => {
  const ran: string[] = []
  const items = sectionItems(
    menuContext({
      copyConversation: () => ran.push('copy'),
      exportConversation: () => ran.push('export'),
    }),
    'conversation',
  )
  for (const item of items) item.run()

  expect(items.map((item) => item.label)).toEqual([
    'Copy Conversation as Markdown',
    'Export Conversation as Markdown…',
  ])
  expect(ran).toEqual(['copy', 'export'])
})

test('a finished turn offers Fork from Here first in the conversation section', () => {
  const ran: string[] = []
  const [fork] = sectionItems(
    menuContext({ canFork: true, fork: () => ran.push('fork') }),
    'conversation',
  )
  fork?.run()

  expect(fork?.label).toBe('Fork from Here')
  expect(ran).toEqual(['fork'])
  expect(itemLabels(menuContext(), 'conversation')).not.toContain('Fork from Here')
})

test('omits the checkpoint section when the message anchors neither action', () => {
  expect(chatMessageMenu(menuContext()).map((entry) => entry.id)).toEqual([
    'copy',
    'conversation',
    'checkpoint',
  ])
  expect(itemLabels(menuContext(), 'checkpoint')).toEqual([])
})

test('a user message with a checkpoint after it offers the revert', () => {
  expect(itemLabels(menuContext({ canRevertCheckpoint: true }), 'checkpoint')).toEqual([
    'Revert to Checkpoint Before This',
  ])
})

test('the revert is destructive and disables itself while one is in flight', () => {
  const [idle] = sectionItems(menuContext({ canRevertCheckpoint: true }), 'checkpoint')
  const [pending] = sectionItems(
    menuContext({ canRevertCheckpoint: true, revertPending: true }),
    'checkpoint',
  )

  expect(idle).toMatchObject({ destructive: true, disabled: false })
  expect(pending).toMatchObject({ destructive: true, disabled: true })
})

test('an assistant message with a readable turn diff offers the changed files', () => {
  expect(
    itemLabels(menuContext({ canViewChangedFiles: true, isAssistant: true }), 'checkpoint'),
  ).toEqual(['View Changed Files'])
})

test('the changed-files item dispatches instead of being gated off', () => {
  const calls: string[] = []
  const [changedFiles] = sectionItems(
    menuContext({
      canViewChangedFiles: true,
      isAssistant: true,
      viewChangedFiles: () => calls.push('viewChangedFiles'),
    }),
    'checkpoint',
  )

  expect(changedFiles?.unavailable).toBeUndefined()

  changedFiles?.run()

  expect(calls).toEqual(['viewChangedFiles'])
})

function sectionItems(context: ChatMessageMenuContext, sectionId: string) {
  const entry = chatMessageMenu(context).find((candidate) => candidate.id === sectionId)

  return (entry?.items ?? []).filter(Boolean) as {
    destructive?: boolean
    disabled?: boolean
    label: string
    run: () => void
    unavailable?: string
  }[]
}

function itemLabels(context: ChatMessageMenuContext, sectionId: string) {
  return sectionItems(context, sectionId).map((item) => item.label)
}

function menuContext(overrides: Partial<ChatMessageMenuContext> = {}): ChatMessageMenuContext {
  return {
    canRevertCheckpoint: false,
    canViewChangedFiles: false,
    canFork: false,
    fork: noop,
    forkPending: false,
    copyConversation: noop,
    copyMarkdown: noop,
    exportConversation: noop,
    copyText: noop,
    hasText: true,
    isAssistant: false,
    revertPending: false,
    revertToCheckpoint: noop,
    viewChangedFiles: noop,
    ...overrides,
  }
}

function noop() {}
