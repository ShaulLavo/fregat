import { act, waitFor } from '@testing-library/react'
import { useImagePreparation } from '@/features/chat/hooks/use-image-preparation'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import { expect, test } from '../../../../../test/fixtures'
import { TEST_ENVIRONMENT_ID, TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { renderHookWithProviders } from '../../../../../test/render'

test('preparing images blocks every composer for the target immediately until all batches are staged', async () => {
  resetChatInputDraftStore()
  const target = {
    environmentId: TEST_ENVIRONMENT_ID,
    draftKey: TEST_SESSION_ID,
    rootPath: '/repo/platform',
  }
  const first = renderHookWithProviders(() => useImagePreparation(target))
  const second = renderHookWithProviders(() => useImagePreparation(target))
  try {
    act(() => {
      first.result.current.prepare([new File(['first'], 'first.png', { type: 'image/png' })])
      first.result.current.prepare([new File(['second'], 'second.png', { type: 'image/png' })])
      expect(first.result.current.isPreparing()).toBe(true)
      expect(second.result.current.isPreparing()).toBe(true)
    })
    expect(second.result.current.preparing).toBe(true)
    await waitFor(() => expect(first.result.current.preparing).toBe(false))
    expect(second.result.current.preparing).toBe(false)
    expect(
      useChatInputDraftStore
        .getState()
        .getDraft(target)
        .images.map((image) => image.name),
    ).toEqual(['first.png', 'second.png'])
    expect(useChatInputDraftStore.getState().preparingImagesByKey).toEqual({})
  } finally {
    first.unmount()
    second.unmount()
    resetChatInputDraftStore()
  }
})
