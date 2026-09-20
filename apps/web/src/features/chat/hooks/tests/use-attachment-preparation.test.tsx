import { vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { useAttachmentPreparation } from '@/features/chat/hooks/use-attachment-preparation'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import { expect, test } from '../../../../../test/fixtures'
import { TEST_ENVIRONMENT_ID, TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { renderHookWithProviders } from '../../../../../test/render'

test('queued attachment batches block every composer and storage failure preserves retryable drafts', async () => {
  vi.stubGlobal('indexedDB', {
    open: () => {
      throw new DOMException('Storage unavailable')
    },
  })
  resetChatInputDraftStore()
  const target = {
    environmentId: TEST_ENVIRONMENT_ID,
    draftKey: TEST_SESSION_ID,
    rootPath: '/repo/platform',
  }
  const first = renderHookWithProviders(() => useAttachmentPreparation(target))
  const second = renderHookWithProviders(() => useAttachmentPreparation(target))
  try {
    act(() => {
      first.result.current.prepare([new File(['first'], 'first.png', { type: 'image/png' })])
      first.result.current.prepare([new File(['second'], 'second.png', { type: 'image/png' })])
      expect(first.result.current.isPreparing()).toBe(true)
      expect(second.result.current.isPreparing()).toBe(true)
    })
    expect(second.result.current.preparing).toBe(true)
    await waitFor(() =>
      expect(
        useChatInputDraftStore
          .getState()
          .getDraft(target)
          .attachments.filter((entry) => entry.upload?.status === 'failed'),
      ).toHaveLength(2),
    )
    expect(second.result.current.preparing).toBe(true)
    expect(
      useChatInputDraftStore
        .getState()
        .getDraft(target)
        .attachments.map((image) => image.name),
    ).toEqual(['first.png', 'second.png'])
    expect(useChatInputDraftStore.getState().preparingAttachmentsByKey).toEqual({})
  } finally {
    first.unmount()
    second.unmount()
    resetChatInputDraftStore()
    vi.unstubAllGlobals()
  }
})
