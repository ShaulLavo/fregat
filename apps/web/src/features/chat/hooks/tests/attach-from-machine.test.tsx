import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act, waitFor } from '@testing-library/react'
import { useAttachmentPreparation } from '@/features/chat/hooks/use-attachment-preparation'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import { chatInputUploadAttachments } from '@/features/chat/utils/input-attachments'
import { expect, test } from '../../../../../test/fixtures'
import { TEST_ENVIRONMENT_ID, TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { renderHookWithProviders } from '../../../../../test/render'

test('files on the machine attach by path, ready to send, and a refused one says why', async ({
  client,
  server,
}) => {
  resetChatInputDraftStore()
  await mkdir(join(server.root, 'project', 'docs'), { recursive: true })
  await writeFile(join(server.root, 'project', 'notes.md'), '# Notes\n')
  await writeFile(join(server.root, 'project', 'docs', 'guide.md'), 'guide\n')
  await writeFile(join(server.root, 'project', 'empty.txt'), '')
  const target = {
    environmentId: TEST_ENVIRONMENT_ID,
    draftKey: TEST_SESSION_ID,
    rootPath: 'project',
  }
  const composer = renderHookWithProviders(() => useAttachmentPreparation(target))
  const attachments = () => useChatInputDraftStore.getState().getDraft(target).attachments
  try {
    await waitFor(() => expect(composer.result.current).not.toBeNull())
    let attached: Promise<boolean> | undefined
    act(() => {
      attached = composer.result.current.attachFromMachine([
        'project/notes.md',
        'project/empty.txt',
        'project/docs/guide.md',
      ])
    })
    await expect(attached).resolves.toBe(true)

    expect(attachments().map((entry) => [entry.name, entry.upload?.status])).toEqual([
      ['notes.md', 'ready'],
      ['guide.md', 'ready'],
    ])
    await waitFor(() => expect(composer.result.current.error).toBe('That file is empty'))
    expect(composer.result.current.preparing).toBe(false)
    // What the composer sends names the copies on the machine, complete and ready to claim.
    const sent = chatInputUploadAttachments(attachments())
    const stored = await Promise.all(
      sent.map(async (attachment) => {
        const response = await client.attachments.uploads({ id: attachment.id }).get()
        return [response.data?.attachment.sizeBytes, response.data?.ready]
      }),
    )
    expect(stored).toEqual([
      [8, true],
      [6, true],
    ])
  } finally {
    composer.unmount()
    resetChatInputDraftStore()
  }
})
