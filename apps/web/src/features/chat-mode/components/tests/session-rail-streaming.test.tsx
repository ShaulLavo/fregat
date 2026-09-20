import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  orchestrationCommandSchema,
  clientOrchestrationCommandSchema,
  messageIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { orchestrationForApp } from 'server/testing'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'
import { useChatShellSubscription } from '@/features/chat/hooks/use-chat-shell-subscription'
import { useSessions } from '@/features/command-palette/hooks/use-sessions'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'

test('real detail stream deltas update the transcript without rendering the rail or palette', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  const sessionId = harness.sessionIds[0]!
  const messageId = v.parse(messageIdSchema, 'streaming-assistant')
  await harness.dispatch(
    v.parse(clientOrchestrationCommandSchema, {
      type: 'session.turn.start',
      commandId: 'streaming-start',
      sessionId,
      turnId: 'streaming-turn',
      message: { messageId: 'streaming-user', role: 'user', text: 'Start streaming' },
    }),
  )
  await harness.refresh()
  const shell = renderHook(() => useChatShellSubscription(harness.context.transport))
  await waitFor(() => expect(shell.result.current.phase).toBe('live'))
  const engine = orchestrationForApp(server.app)
  const release = harness.context.transport!.retainSessionDetail(sessionId)
  const readSlice = () => useChatProjectionStore.getState().slices[harness.environmentId]!
  await waitFor(() => expect(readSlice().sessionDetailSequenceById[sessionId]).toBeDefined())
  let railRenders = 0
  let paletteRenders = 0
  renderRailHarness(harness, false, () => {
    railRenders += 1
  })
  const palette = renderHook(() => {
    paletteRenders += 1
    return useSessions()
  })
  const append = async (index: number) => {
    let sequence = 0
    await act(async () => {
      const receipt = await engine.dispatch(
        v.parse(orchestrationCommandSchema, {
          type: 'session.message.assistant.delta',
          commandId: `streaming-delta-${index}`,
          sessionId,
          messageId,
          turnId: 'streaming-turn',
          delta: 'token ',
          createdAt: new Date().toISOString(),
        }),
      )
      sequence = receipt.sequence
    })
    await waitFor(() =>
      expect(readSlice().messageBySessionId[sessionId]?.[messageId]?.text).toBe(
        'token '.repeat(index + 1),
      ),
    )
    await waitFor(() =>
      expect(readSlice().lastAppliedShellSequence).toBeGreaterThanOrEqual(sequence),
    )
    await act(async () => {})
  }
  try {
    const search = screen.getByRole('searchbox', { name: 'Search sessions' })
    await userEvent.type(search, 'First')
    await waitFor(() =>
      expect(useSessionSearchStore.getState()).toMatchObject({
        matchedQuery: 'First',
        searching: false,
      }),
    )
    await userEvent.clear(search)
    await waitFor(() =>
      expect(useSessionSearchStore.getState()).toMatchObject({
        matchedQuery: '',
        searching: false,
      }),
    )
    await append(0)
    const before = { rail: railRenders, palette: paletteRenders }
    for (let index = 1; index <= 20; index += 1) await append(index)
    expect({ rail: railRenders - before.rail, palette: paletteRenders - before.palette }).toEqual({
      rail: 0,
      palette: 0,
    })
    await act(async () => {
      await harness.dispatch(
        v.parse(clientOrchestrationCommandSchema, {
          type: 'session.meta.update',
          commandId: 'streaming-rename',
          sessionId,
          title: 'Renamed',
        }),
      )
      await harness.refresh()
    })
    expect(screen.getByTitle('Renamed')).toBeVisible()
    expect(palette.result.current.sessions.find((session) => session.id === sessionId)?.title).toBe(
      'Renamed',
    )
    expect(railRenders).toBeGreaterThan(before.rail)
    expect(paletteRenders).toBeGreaterThan(before.palette)
  } finally {
    release()
  }
})
