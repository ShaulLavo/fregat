import { ws } from 'msw'
import * as v from 'valibot'
import {
  ORCHESTRATION_WS_PROTOCOL_VERSION,
  orchestrationWsClientMessageSchema,
  type OrchestrationWsClientMessage,
  type OrchestrationWsServerConfig,
} from '@workspace/contracts'
import { DEMO_ENVIRONMENT, DEMO_TIME } from '../seed'
import { DemoOrchestration } from '../state/orchestration'

export const DEMO_SERVER_CONFIG: OrchestrationWsServerConfig = {
  environmentId: DEMO_ENVIRONMENT,
  protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION,
  serverVersion: 'demo',
  serverInstanceId: 'garden-demo',
  startedAt: DEMO_TIME,
  capabilities: { resume: false, synchronizedMarker: true },
  limits: { replayMaxEvents: 1000, resumeMaxGap: 1000 },
}

type Send = (message: unknown) => void
export type DemoSocketFrame = {
  direction: 'client' | 'server'
  message: unknown
}

export function demoOrchestrationHandler(
  apiOrigin: string,
  orchestration: DemoOrchestration,
  record: (frame: DemoSocketFrame) => void = () => {},
) {
  const socket = ws.link(`${apiOrigin.replace(/^http/u, 'ws')}/orchestration/rpc`)
  return socket.addEventListener('connection', ({ client }) => {
    const subscriptions = new Map<string, string | null>()
    const send: Send = (message) => {
      record({ direction: 'server', message })
      client.send(JSON.stringify(message))
    }
    const publish = () => publishSubscriptions(send, subscriptions, orchestration)
    orchestration.workspace.updates.add(publish)
    send({ kind: 'connected', config: DEMO_SERVER_CONFIG })
    client.addEventListener('message', (event) => {
      record({ direction: 'client', message: event.data })
      receive(event.data, send, subscriptions, orchestration)
    })
    client.addEventListener('close', () => orchestration.workspace.updates.delete(publish))
  })
}

function receive(
  data: unknown,
  send: Send,
  subscriptions: Map<string, string | null>,
  orchestration: DemoOrchestration,
) {
  if (typeof data !== 'string') return
  const parsed = v.safeParse(orchestrationWsClientMessageSchema, JSON.parse(data))
  if (!parsed.success) return
  const message = parsed.output
  if (message.kind === 'ping') {
    send({ kind: 'pong', requestId: message.requestId })
    return
  }
  if (message.kind === 'unsubscribe') {
    subscriptions.delete(message.subscriptionId)
    return
  }
  if (message.kind === 'subscribe') {
    subscriptions.set(
      message.subscriptionId,
      message.method === 'subscribeSession' ? message.sessionId : null,
    )
    publishSubscription(
      send,
      message.subscriptionId,
      subscriptions.get(message.subscriptionId) ?? null,
      orchestration,
    )
    send({
      kind: 'subscription.next',
      subscriptionId: message.subscriptionId,
      item: { kind: 'synchronized', sequence: orchestration.workspace.sequence },
    })
    return
  }
  try {
    send({
      kind: 'response',
      requestId: message.requestId,
      ok: true,
      data: request(message, orchestration),
    })
  } catch (error) {
    send({
      kind: 'response',
      requestId: message.requestId,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: 'DEMO_REQUEST_FAILED',
      },
    })
  }
}

function request(
  message: Extract<OrchestrationWsClientMessage, { kind: 'request' }>,
  orchestration: DemoOrchestration,
) {
  if (message.method === 'serverConfig') return DEMO_SERVER_CONFIG
  if (message.method === 'dispatchCommand') return orchestration.dispatch(message.command)
  if (message.method === 'replayEvents') return { events: [] }
  return {
    sessionId: message.input.sessionId,
    snapshotSequence: orchestration.workspace.sequence,
    messages: [],
    activities: [],
    hasEarlier: false,
  }
}

function publishSubscriptions(
  send: Send,
  subscriptions: ReadonlyMap<string, string | null>,
  orchestration: DemoOrchestration,
) {
  for (const [id, sessionId] of subscriptions)
    publishSubscription(send, id, sessionId, orchestration)
}

function publishSubscription(
  send: Send,
  id: string,
  sessionId: string | null,
  orchestration: DemoOrchestration,
) {
  const snapshot = sessionId ? orchestration.detail(sessionId) : orchestration.shell()
  send({ kind: 'subscription.next', subscriptionId: id, item: { kind: 'snapshot', snapshot } })
}
