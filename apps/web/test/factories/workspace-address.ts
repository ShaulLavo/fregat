import { workspaceAddressSchema, type WorkspaceAddress } from '@workspace/contracts'
import { stablePathHash } from '@workspace/client-core/address/path-hash'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { normalizeWorkspaceRoot, workspacePathLeaf } from '@workspace/client-core/files/path'
import * as v from 'valibot'
import type { Client } from '@/lib/client'

export function testWorkspaceAddress(
  path: string,
  name = workspacePathLeaf(path),
): WorkspaceAddress {
  const suffix = stablePathHash(normalizeWorkspaceRoot(path))
  return v.parse(workspaceAddressSchema, {
    id: `Fixture_${suffix}`,
    name,
    path,
  })
}

export function testWorkspaceToken(path: string, name?: string): string {
  return workspaceToken(testWorkspaceAddress(path, name))
}

export async function registerTestWorkspaceAddress(client: Client, path: string) {
  return v.parse(workspaceAddressSchema, (await client.fs['workspace-address'].post({ path })).data)
}
