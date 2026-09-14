import type { Page } from 'playwright'

export type Observed = {
  errors: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
  failedResponses: { url: string; status: number; type: string }[]
  failedRequests: { url: string; error: string | undefined }[]
  loopbackRequests: string[]
  assets: Set<string>
  apiResponses: { url: string; status: number }[]
  sockets: { url: string; receivedFrames: number; errors: string[] }[]
}

export function attachObserver(page: Page, base: string): Observed
export function serializable(observed: Observed): Record<string, unknown>
export function observedProblems(observed: Observed, options?: { loopback?: boolean }): string[]
