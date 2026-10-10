import type { Page } from 'playwright'

export type TerminalRendering = {
  count: number
  promptRendered: boolean
  rendererBackend: string | null
  closed: boolean
}

export function emptyWorkbenchUrl(base: string): string
export function waitForTerminalPrompt(
  page: Page,
  prompt: string,
  timeoutMs?: number,
): Promise<Pick<TerminalRendering, 'count' | 'promptRendered'>>
export function terminalFailures(terminal: TerminalRendering): string[]

export function terminalReleaseFailures(
  deployed: unknown,
  backend: unknown,
  protocolVersion: number,
): string[]
export function foreignTerminalRequests(
  requests: readonly string[],
  origins: readonly string[],
): string[]
