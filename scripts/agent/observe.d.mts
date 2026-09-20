import type { Page } from 'playwright'

export type Observed = {
  consoleCapture: boolean
  logUploads: { requests: number; bytes: number; events: number; instances: string[] }
  errors: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
  consoleDetails: {
    level: string
    text: string
    url: string
    lineNumber: number
    columnNumber: number
  }[]
  failedResponses: { url: string; status: number; type: string }[]
  failedRequests: { url: string; error: string | undefined }[]
  loopbackRequests: string[]
  assets: Set<string>
  apiResponses: { url: string; status: number }[]
  serviceWorkerResponses: { url: string; status: number; type: string }[]
  sockets: { url: string; receivedFrames: number; errors: string[] }[]
}

export function attachObserver(
  page: Page,
  base: string,
  options?: { consoleCapture?: boolean },
): Observed
export function serializable(observed: Observed): Record<string, unknown>
export function observedProblems(observed: Observed, options?: { loopback?: boolean }): string[]
