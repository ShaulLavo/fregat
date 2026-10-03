import { readFile, stat } from 'node:fs/promises'
import { usageAccountLabel } from './usage-account-label'
import { codexAccountIdentity } from './usage-codex-identity'

export type NativeUsageMetadata = { label?: string; identityProof: string | null }

/** Optional CLI metadata supplies presentation and a local Codex comparison proof. */
export async function readNativeUsageMetadata(
  filePath: string,
  driverKind: 'claude' | 'codex',
  identityContext?: string,
): Promise<NativeUsageMetadata> {
  try {
    if ((await stat(filePath)).size > 2 * 1024 * 1024) return { identityProof: null }
    const value = JSON.parse(await readFile(filePath, 'utf8'))
    if (driverKind === 'claude')
      return { label: usageAccountLabel(value?.oauthAccount?.emailAddress), identityProof: null }
    const identityProof = codexAccountIdentity(value?.tokens?.account_id, identityContext)
    const token = value?.tokens?.id_token
    if (typeof token !== 'string') return { identityProof }
    const payload = token.split('.')[1]
    if (!payload) return { identityProof }
    let label: string | undefined
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      label = usageAccountLabel(claims?.email)
    } catch {
      // Optional presentation metadata does not invalidate the separate account ID.
    }
    return { label, identityProof }
  } catch {
    return { identityProof: null }
  }
}
