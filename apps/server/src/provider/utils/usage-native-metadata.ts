import { readFile, stat } from 'node:fs/promises'
import { usageAccountLabel } from './usage-account-label'

/** Optional CLI metadata supplies a short label even before an allowance observation. */
export async function readNativeUsageLabel(
  filePath: string,
  driverKind: 'claude' | 'codex',
): Promise<string | undefined> {
  try {
    if ((await stat(filePath)).size > 2 * 1024 * 1024) return undefined
    const value = JSON.parse(await readFile(filePath, 'utf8'))
    if (driverKind === 'claude') return usageAccountLabel(value?.oauthAccount?.emailAddress)
    const token = value?.tokens?.id_token
    if (typeof token !== 'string') return undefined
    const payload = token.split('.')[1]
    if (!payload) return undefined
    return usageAccountLabel(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.email)
  } catch {
    return undefined
  }
}
