import * as v from 'valibot'
import {
  workspaceAddressIdSchema,
  type WorkspaceAddress,
  type WorkspaceAddressId,
} from '@workspace/contracts'

export const NO_WORKSPACE_TOKEN = '-'

export type WorkspaceToken =
  | { readonly kind: 'workspace'; readonly id: WorkspaceAddressId }
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }

export function workspaceToken(address: Pick<WorkspaceAddress, 'id' | 'name'>): string {
  return `${address.name}.${address.id}`
}

export function parseWorkspaceToken(token: string): WorkspaceToken {
  if (token === NO_WORKSPACE_TOKEN) return { kind: 'none' }
  const separator = token.lastIndexOf('.')
  if (separator < 1) return { kind: 'invalid' }
  const parsed = v.safeParse(workspaceAddressIdSchema, token.slice(separator + 1))
  if (!parsed.success) return { kind: 'invalid' }
  return { kind: 'workspace', id: parsed.output }
}
