import { createHash } from 'node:crypto'
import * as v from 'valibot'
import { projectIdSchema, worktreeIdSchema, type RepositoryIdentity } from '@workspace/contracts'

const PROJECT_ID_NAMESPACE = '9497149c-4cca-4c3e-8846-f6733d6fb85f'
const WORKTREE_ID_NAMESPACE = '53024065-1d42-4d11-b22f-5fbb93d10531'

export function repositoryKey(identity: RepositoryIdentity) {
  return createHash('sha256').update(`${identity.source}\0${identity.canonical}`).digest('hex')
}

export function projectIdForRepository(key: string) {
  return v.parse(projectIdSchema, uuidV5(PROJECT_ID_NAMESPACE, key))
}

export function worktreeIdForCheckout(key: string, canonicalPath: string) {
  return v.parse(worktreeIdSchema, uuidV5(WORKTREE_ID_NAMESPACE, `${key}\0${canonicalPath}`))
}

export function internalCommandKey(kind: string, ...parts: readonly (string | number)[]) {
  const fingerprint = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${kind}:${fingerprint}`
}

function uuidV5(namespace: string, name: string) {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name)
    .digest()
    .subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
