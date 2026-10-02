import { createHash } from 'node:crypto'
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isRecord } from '@workspace/utils/objects'
import { installedIdentity } from './installed-app'
import { launcherErrors } from './structured-errors'

export function installReceipt(url: string, manifest?: string) {
  if (manifest === undefined) return undefined
  const { manifestId } = installedIdentity(url)
  const manifestUrl = new URL('manifest.webmanifest', manifestId)
  let parsed: unknown
  try {
    parsed = JSON.parse(manifest)
  } catch {
    throw launcherErrors.LAUNCH_FAILED({ internal: { reason: 'manifest-json' } })
  }
  if (!isRecord(parsed) || typeof parsed.id !== 'string' || typeof parsed.start_url !== 'string')
    throw launcherErrors.LAUNCH_FAILED({ internal: { reason: 'manifest-fields' } })
  const id = URL.parse(parsed.id, manifestUrl)
  const start = URL.parse(parsed.start_url, manifestUrl)
  if (id?.href !== manifestId || !start || start.origin !== manifestUrl.origin)
    throw launcherErrors.LAUNCH_FAILED({ internal: { reason: 'manifest-identity' } })
  return {
    manifestId,
    startUrl: start.href,
    manifestHash: createHash('sha256').update(manifest).digest('hex'),
  }
}

type InstallReceipt = NonNullable<ReturnType<typeof installReceipt>>

function receiptFile(profile: string) {
  return path.join(path.dirname(profile), path.basename(profile) + '.installed.json')
}

export function hasVerifiedInstall(profile: string, receipt: InstallReceipt | undefined) {
  if (!receipt) return false
  try {
    const stored: unknown = JSON.parse(readFileSync(receiptFile(profile), 'utf8'))
    if (!isRecord(stored)) return false
    const matches = Object.entries(receipt).every(([key, value]) => stored[key] === value)
    const { appId } = installedIdentity(receipt.manifestId)
    // Chrome removes this per-app resource tree on uninstall; the receipt alone can be stale.
    const resources = path.join(
      profile,
      'Platform',
      'Web Applications',
      'Manifest Resources',
      appId,
    )
    return matches && statSync(resources).isDirectory()
  } catch {
    return false
  }
}

export function rememberVerifiedInstall(profile: string, receipt: InstallReceipt | undefined) {
  if (!receipt) return
  const file = receiptFile(profile)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(receipt), { mode: 0o600 })
  renameSync(temporary, file)
}

export function forgetVerifiedInstall(profile: string) {
  try {
    unlinkSync(receiptFile(profile))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function readInstallManifest(url: string, signal: AbortSignal) {
  const manifestUrl = new URL('manifest.webmanifest', installedIdentity(url).manifestId)
  const response = await fetch(manifestUrl, { signal, cache: 'no-store' })
  if (!response.ok)
    throw launcherErrors.LAUNCH_FAILED({
      internal: { reason: 'manifest-http', status: response.status },
    })
  return response.text()
}
