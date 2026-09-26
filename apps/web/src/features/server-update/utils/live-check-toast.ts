import type { LiveCheckVerdict } from '@workspace/contracts'

/** Names a failed verdict that arrived during this page's life; a reload never re-toasts it. */
export function liveCheckToastId(
  verdict: LiveCheckVerdict | null | undefined,
  pageStartedAt: number,
): string | null {
  if (!verdict || verdict.status !== 'failed' || !verdict.error) return null
  if (Date.parse(verdict.at) <= pageStartedAt) return null
  return `live-check:${verdict.release}:${verdict.at}`
}
