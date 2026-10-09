import type { APIRequestContext, Page } from 'playwright'

import { createScriptError } from '../structured-errors'
import type { Evidence } from './evidence'

export type CaptureTerminal = {
  readonly socketUrl: string
  readonly killUrl: string
  readonly worktreeId: string
  readonly terminalId: string
}

export function capturedTerminal(socketUrl: string, prefix: string): CaptureTerminal | undefined {
  const url = new URL(socketUrl)
  const terminalId = url.searchParams.get('terminalId')
  const worktreeId = url.searchParams.get('worktreeId')
  if (
    !url.pathname.endsWith('/terminal') ||
    !terminalId?.startsWith(prefix) ||
    !worktreeId ||
    url.searchParams.has('agentSessionId')
  )
    return undefined
  const kill = new URL(url)
  kill.protocol = kill.protocol === 'wss:' ? 'https:' : 'http:'
  kill.pathname += '/kill'
  kill.search = ''
  return { socketUrl, killUrl: kill.href, worktreeId, terminalId }
}

export async function isolateProductTerminals(page: Page, evidence: Evidence) {
  const prefix = `product-capture-${crypto.randomUUID()}-`
  const sessions = new Map<string, CaptureTerminal>()
  const unexpected: string[] = []
  const request = page.context().request
  page.on('websocket', (socket) => {
    const url = new URL(socket.url())
    if (!url.pathname.endsWith('/terminal')) return
    const session = capturedTerminal(socket.url(), prefix)
    if (!session) {
      unexpected.push(socket.url())
      return
    }
    sessions.set(JSON.stringify([url.origin, session.worktreeId, session.terminalId]), session)
  })
  await installCaptureTerminalNamespace(page, prefix)

  return async () => {
    if (!page.isClosed())
      throw createScriptError('Close the capture page before disposing its terminals.')
    const results = await Promise.all(
      Array.from(sessions.values(), (session) => killCaptureTerminal(request, session)),
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

export async function installCaptureTerminalNamespace(page: Page, prefix: string) {
  await page.addInitScript((namespace) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return
    sessionStorage.setItem('fregat.terminal-namespace', namespace)
  }, prefix)
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
