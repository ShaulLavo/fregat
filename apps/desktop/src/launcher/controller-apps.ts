import { isRecord } from '@workspace/utils/objects'
import type { CdpClient } from './cdp'
import { launcherErrors } from './structured-errors'

export async function controllerAppUrls(cdp: Pick<CdpClient, 'request'>, launcherUrl: string) {
  const result = await cdp.request('Target.getTargets')
  if (!Array.isArray(result.targetInfos))
    throw launcherErrors.CDP_FAILED({ internal: { reason: 'controller-target-list' } })
  const urls = new Set([launcherUrl])
  // The dedicated controller starts on about:blank; page targets are OS-launched app windows.
  for (const target of result.targetInfos) {
    if (!isRecord(target) || target.type !== 'page' || typeof target.url !== 'string') continue
    const url = URL.parse(target.url)
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) continue
    urls.add(url.href)
  }
  return [...urls]
}
