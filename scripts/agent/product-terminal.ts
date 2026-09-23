import type { APIRequestContext, Page } from 'playwright'

import { createScriptError } from '../structured-errors'
import type { Evidence } from './evidence'

type CaptureTerminal = {
  readonly socketUrl: string
  readonly killUrl: string
  readonly worktreeId: string
  readonly terminalId: string
}

export async function isolateProductTerminals(page: Page, evidence: Evidence) {
  const prefix = `product-capture-${crypto.randomUUID()}-`
  const sessions = new Map<string, CaptureTerminal>()
  const unexpected: string[] = []
  const request = page.context().request
  page.on('websocket', (socket) => {
    const url = new URL(socket.url())
    if (!url.pathname.endsWith('/terminal')) return
    const terminalId = url.searchParams.get('terminalId')
    const worktreeId = url.searchParams.get('worktreeId')
    if (!terminalId?.startsWith(prefix) || !worktreeId || url.searchParams.has('agentSessionId')) {
      unexpected.push(socket.url())
      return
    }
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname += '/kill'
    url.search = ''
    const session = { socketUrl: socket.url(), killUrl: url.href, worktreeId, terminalId }
    sessions.set(JSON.stringify([url.origin, worktreeId, terminalId]), session)
  })
  await page.addInitScript(installCaptureSocketPrefix, prefix)

  return async () => {
    if (!page.isClosed())
      throw createScriptError('Close the capture page before disposing its terminals.')
    const results = await Promise.all(
      [...sessions.values()].map((session) => killCaptureTerminal(request, session)),
    )
    const path = await evidence.json('product-terminals.json', {
      prefix,
      sessions: results,
      unexpected,
    })
    const failures = results.filter((result) => result.error !== null)
    if (unexpected.length > 0 || failures.length > 0)
      throw createScriptError(`Product terminal isolation or cleanup failed; see ${path}.`)
    return path
  }
}

export function installCaptureSocketPrefix(prefix: string) {
  const NativeWebSocket = globalThis.WebSocket
  // Browser storage is fresh, but the server's terminal-1 session may belong to the user.
  globalThis.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const url = new URL(String(args[0]), Reflect.get(globalThis, 'location').href)
      if (!url.pathname.endsWith('/terminal')) return Reflect.construct(target, args, newTarget)
      const terminalId = url.searchParams.get('terminalId')
      if (!terminalId || url.searchParams.has('agentSessionId'))
        throw new DOMException(
          'Product captures require an isolated shell terminal.',
          'NotSupportedError',
        )
      if (!terminalId.startsWith(prefix))
        url.searchParams.set('terminalId', `${prefix}${terminalId}`)
      return Reflect.construct(target, [url.href, ...args.slice(1)], newTarget)
    },
  })
}

export async function killCaptureTerminal(request: APIRequestContext, session: CaptureTerminal) {
  try {
    const response = await request.post(session.killUrl, {
      data: { worktreeId: session.worktreeId, terminalId: session.terminalId },
      headers: { origin: new URL(session.killUrl).origin },
      timeout: 10_000,
    })
    const result: unknown = await response.json()
    if (
      !response.ok() ||
      !result ||
      typeof result !== 'object' ||
      !('killed' in result) ||
      typeof result.killed !== 'boolean'
    )
      throw createScriptError(
        `Terminal cleanup returned an invalid response (${response.status()}).`,
      )
    return { ...session, killed: result.killed, error: null }
  } catch (error) {
    return {
      ...session,
      killed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
