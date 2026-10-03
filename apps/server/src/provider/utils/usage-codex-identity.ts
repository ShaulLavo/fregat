import { createHmac, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { ProviderAccountUsage } from '@workspace/contracts'
import { writeFileAtomicSync } from '../../fs/atomic-write'

const proxyIdentities = new WeakMap<ProviderAccountUsage, string>()

/** The comparison key stays in a private local file, separate from account snapshots. */
export function usageIdentityContext(cacheFile: string | undefined): string {
  const file = cacheFile ? `${cacheFile}.identity` : null
  try {
    if (file && statSync(file).size === 64) {
      const value = readFileSync(file, 'utf8')
      if (/^[a-f0-9]{64}$/.test(value)) return value
    }
  } catch {}
  const context = randomBytes(32).toString('hex')
  if (!file) return context
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileAtomicSync(file, context, { durability: 'fsync-file', mode: 0o600 })
  } catch {
    // A temporary key still proves equality in this process; restart invalidates its proofs.
  }
  return context
}

export function codexAccountIdentity(value: unknown, context: string | undefined): string | null {
  if (!context || typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) return null
  return createHmac('sha256', context).update(`chatgpt-account\0${value}`).digest('hex')
}

/** Weak metadata never becomes a property of a public account or serialized snapshot. */
export function rememberProxyUsageIdentity(account: ProviderAccountUsage, identity: string | null) {
  if (identity) proxyIdentities.set(account, identity)
}

export function proxyUsageIdentity(account: ProviderAccountUsage): string | null {
  return proxyIdentities.get(account) ?? null
}
