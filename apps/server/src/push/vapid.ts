import { createECDH } from 'node:crypto'
import { generateVAPIDKeys } from 'web-push'
import { VAPID_PRIVATE_KEY_REF } from '../settings/secrets'
import type { SettingsStore } from '../settings/store'

export type VapidKeys = {
  /** Uncompressed P-256 point, base64url: the browser's `applicationServerKey`. */
  readonly publicKey: string
  readonly privateKey: string
}

/**
 * Reads the key pair, generating the private key into the secret store on first use.
 * `onGenerate` runs before a new key replaces a lost one, while old subscriptions still exist.
 */
export async function loadVapidKeys(
  settings: SettingsStore,
  onGenerate: () => void,
): Promise<VapidKeys> {
  const privateKey = await settings.ensureSecret(VAPID_PRIVATE_KEY_REF, () => {
    onGenerate()
    return generateVAPIDKeys().privateKey
  })

  return { privateKey, publicKey: vapidPublicKey(privateKey) }
}

// Derived, so only the private key is stored and the halves cannot drift apart.
function vapidPublicKey(privateKey: string) {
  const curve = createECDH('prime256v1')
  curve.setPrivateKey(Buffer.from(privateKey, 'base64url'))

  return curve.getPublicKey().toString('base64url')
}
