import { isRecord } from '@workspace/utils/objects'
import type { CdpClient } from './cdp'

// macOS keeps the browser process alive after its last app window closes.
export function closeLastMacPage(
  cdp: Pick<CdpClient, 'on' | 'request'>,
  onFailure: (error: unknown) => void,
) {
  const pages = new Set<string>()
  let closing = false
  const created = cdp.on('Target.targetCreated', ({ params }) => {
    const info = params.targetInfo
    if (isRecord(info) && info.type === 'page' && typeof info.targetId === 'string')
      pages.add(info.targetId)
  })
  const destroyed = cdp.on('Target.targetDestroyed', ({ params }) => {
    if (typeof params.targetId !== 'string' || !pages.delete(params.targetId)) return
    if (pages.size || closing) return
    closing = true
    void cdp.request('Browser.close').catch(onFailure)
  })
  return () => {
    created()
    destroyed()
  }
}
