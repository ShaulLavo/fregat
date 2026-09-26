import { deepStrictEqual, equal, ok } from 'node:assert/strict'
import type { Page, WebSocketRoute } from 'playwright'
import * as v from 'valibot'
import {
  orchestrationWsClientMessageSchema,
  orchestrationWsServerMessageSchema,
} from '../../../packages/contracts/src/index'
import { orchestrationStreamItemSequence } from '../../../packages/client-core/src/transport/utils/sequence'
import { selectors } from '../selectors'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

const PARAGRAPHS = Array.from({ length: 2500 }, (_, index) => `Overflow paragraph ${index + 1}.`)

/** Withhold a consumed frame's ACK until delivery fails, then let the real client recover. */
async function interruptDelivery(page: Page, sessionId: string) {
  const proof = {
    armed: false,
    blockedSubscription: '',
    appliedCursor: 0,
    errorCode: '',
    resumeCursor: -1,
    synchronized: false,
    socketCloses: 0,
    socketConnections: 0,
  }
  await page.routeWebSocket(/\/orchestration\/rpc(?:\?|$)/, (socket) =>
    connectDelivery(socket, sessionId, proof),
  )
  await page.reload()
  await selectors.chatMessage(page).waitFor({ timeout: 30_000 })
  proof.armed = true
  return proof
}

function connectDelivery(
  socket: WebSocketRoute,
  sessionId: string,
  proof: Awaited<ReturnType<typeof interruptDelivery>>,
) {
  proof.socketConnections += 1
  let sessionSubscription = ''
  const deliveries = new Map<number, number>()
  const server = socket.connectToServer()
  socket.onMessage((raw) => {
    const message = v.parse(orchestrationWsClientMessageSchema, JSON.parse(String(raw)))
    if (
      message.kind === 'subscribe' &&
      message.method === 'subscribeSession' &&
      message.sessionId === sessionId
    ) {
      sessionSubscription = message.subscriptionId
      if (proof.errorCode) proof.resumeCursor = message.afterSequence
    }
    if (
      message.kind === 'subscription.ack' &&
      message.subscriptionId === sessionSubscription &&
      proof.armed &&
      !proof.errorCode
    ) {
      // The client sends ACK only after applying the frame to its projection.
      proof.blockedSubscription = message.subscriptionId
      proof.appliedCursor = deliveries.get(message.deliveryId) ?? proof.appliedCursor
      return
    }
    server.send(raw)
  })
  server.onMessage((raw) => {
    const message = v.parse(orchestrationWsServerMessageSchema, JSON.parse(String(raw)))
    if (message.kind === 'subscription.next' && message.subscriptionId === sessionSubscription) {
      const sequence =
        message.item.kind === 'synchronized'
          ? message.item.sequence
          : orchestrationStreamItemSequence(message.item)
      deliveries.set(message.deliveryId, sequence)
      if (proof.resumeCursor >= 0 && message.item.kind === 'synchronized') proof.synchronized = true
    }
    if (
      message.kind === 'subscription.error' &&
      message.subscriptionId === proof.blockedSubscription
    )
      proof.errorCode = message.error.code ?? ''
    socket.send(raw)
  })
  server.onClose((code, reason) => {
    proof.socketCloses += 1
    void socket.close({ code, reason })
  })
}

async function exactClientAnswer(page: Page) {
  await selectors
    .chatMessages(page)
    .getByText(PARAGRAPHS.at(-1)!, { exact: true })
    .waitFor({ timeout: 60_000 })
  const answers = selectors.chatAssistantMarkdown(page)
  equal(await answers.count(), 1, 'Exactly one client-rendered assistant message')
  deepStrictEqual(
    await answers.locator('p').allTextContents(),
    PARAGRAPHS,
    'Every client paragraph is present, ordered and appears exactly once',
  )
}

export const streamOverflow = isolatedNativeScenario({
  name: 'stream-overflow',
  description:
    'Withhold session ACKs during a 2,500-paragraph fixture answer, assert delivery failure and resubscription from the applied cursor, then compare every client paragraph before and after reload.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, sessionId }) {
    const proof = await interruptDelivery(page, sessionId)
    await sendPrompt(page, 'Write the long answer.')
    for (let attempt = 0; attempt < 900 && !proof.synchronized; attempt += 1) await Bun.sleep(100)
    ok(proof.blockedSubscription, 'A session ACK was withheld')
    ok(
      ['orchestration.LIVE_STREAM_OVERFLOW', 'orchestration.LIVE_STREAM_ACK_TIMEOUT'].includes(
        proof.errorCode,
      ),
      'The server explicitly closed the stalled delivery',
    )
    ok(proof.appliedCursor > 0, 'A nonzero cursor was applied before interruption')
    equal(
      proof.resumeCursor,
      proof.appliedCursor,
      'The client resubscribes from its last applied cursor',
    )
    ok(proof.synchronized, 'The resumed subscription reaches its synchronization marker')
    if (proof.errorCode === 'orchestration.LIVE_STREAM_ACK_TIMEOUT') {
      ok(proof.socketCloses > 0, 'ACK timeout closes the socket before reconnect')
      ok(proof.socketConnections > 1, 'The client opens a new socket after ACK timeout')
    }
    await exactClientAnswer(page)
    await step('reconnected-from-applied-cursor-with-complete-text')
    const recovery = { ...proof }
    await page.reload()
    await exactClientAnswer(page)
    await step('same-complete-client-text-after-reload')
    return recovery
  },
})
