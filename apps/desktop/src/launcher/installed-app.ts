import { createHash } from 'node:crypto'
import type { CdpClient } from './cdp'
import { launcherErrors } from './structured-errors'

export function installedIdentity(url: string) {
  const manifestId = new URL('./', url).href
  // Chromium hashes the URL twice, with the second hash consuming the first raw digest.
  const manifestDigest = createHash('sha256').update(manifestId).digest()
  const digest = createHash('sha256').update(manifestDigest).digest('hex').slice(0, 32)
  const appId = Array.from(digest, (digit) =>
    String.fromCharCode(97 + Number.parseInt(digit, 16)),
  ).join('')
  return { manifestId, appId }
}

export async function ensureInstalledApp(cdp: Pick<CdpClient, 'request'>, url: string) {
  const { manifestId, appId } = installedIdentity(url)
  const request = async (method: string, params: Record<string, unknown>) => {
    try {
      return await cdp.request(method, params)
    } catch (error) {
      const internal = (error as { internal?: Record<string, unknown> }).internal
      if (internal?.protocolCode === -32601 || internal?.protocolReason === 'pwa-unavailable')
        throw launcherErrors.PWA_UNSUPPORTED({
          internal: { method, protocolCode: internal.protocolCode },
        })
      throw error
    }
  }
  const state = () => request('PWA.getOsAppState', { manifestId })
  try {
    await state()
  } catch (error) {
    const internal = (error as { internal?: Record<string, unknown> }).internal
    if (internal?.protocolReason !== 'unknown-app') throw error
    await request('PWA.install', {
      manifestId,
      installUrlOrBundleUrl: new URL('install.html', manifestId).href,
    })
    await state()
  }
  await request('PWA.changeAppUserSettings', { manifestId, displayMode: 'standalone' })
  return { manifestId, appId }
}
