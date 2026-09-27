import { act, useSyncExternalStore } from 'react'
import type { ChatOwner } from '@workspace/client-core/chat/owner'

import { usePlaces } from '@/files/hooks/use-places'
import { test, expect } from '../../../test/fixtures'
import { appendChatMessages, draftChatTurn, openTestChat } from '../../../test/factories/chat'
import { renderTui } from '../../../test/render'

function Places({ chat, onRender }: { chat: ChatOwner; onRender: () => void }) {
  onRender()
  const places = usePlaces(chat)
  return <text>{`places ${places.length}`}</text>
}

// Reads the whole snapshot, so it shows the chat events do reach React.
function WholeSnapshot({ chat, onRender }: { chat: ChatOwner; onRender: () => void }) {
  onRender()
  useSyncExternalStore(chat.subscribe, chat.getSnapshot)
  return <text>whole</text>
}

test('streaming replies do not re-render a places reader', async ({ server }) => {
  const { session, chat } = await openTestChat(server)
  let placesRenders = 0
  let wholeRenders = 0
  const frame = await renderTui(
    <>
      <Places chat={chat} onRender={() => (placesRenders += 1)} />
      <WholeSnapshot chat={chat} onRender={() => (wholeRenders += 1)} />
    </>,
    { width: 40, height: 4 },
  )
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const turn = draftChatTurn(worktreeId)
    await act(async () => {
      await chat.dispatch(turn.command)
      chat.selectSession(turn.command.sessionId)
    })
    await expect.poll(() => chat.getSnapshot().detailLoading).toBe(false)
    const places = placesRenders
    const whole = wholeRenders

    await act(async () => {
      await appendChatMessages(server, { sessionId: turn.command.sessionId, count: 5 })
    })
    await expect.poll(() => wholeRenders).toBeGreaterThan(whole)

    expect(placesRenders).toBe(places)
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})
