import { createClientInvariantError } from '@/lib/structured-errors'

export function secureOperationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  throw createClientInvariantError('Secure workspace operation identifiers are unavailable')
}

/** The digest lets a retried prepare prove it is the same request, not a new one reusing an id. */
export async function workspaceEditPrepareBody<Body extends object>(
  body: Body,
): Promise<Body & { readonly bodyDigest: string }> {
  if (!globalThis.crypto?.subtle) {
    throw createClientInvariantError('Secure workspace edit digest support is unavailable')
  }
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return { ...body, bodyDigest: `sha256:${Array.from(digest, hexByte).join('')}` }
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0')
}
