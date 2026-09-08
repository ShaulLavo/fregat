import * as v from 'valibot'
import type { FileSystemEntryMetadata } from './tree-entry'

export const WORKSPACE_ADDRESS_ID_LENGTH = 16

export const workspaceAddressIdSchema = v.pipe(
  v.string(),
  v.length(WORKSPACE_ADDRESS_ID_LENGTH),
  v.regex(/^[A-Za-z0-9_-]+$/u),
  v.brand('WorkspaceAddressId'),
)

export const workspaceAddressSchema = v.object({
  id: workspaceAddressIdSchema,
  name: v.pipe(v.string(), v.minLength(1)),
  path: v.string(),
})

export type WorkspaceAddressId = v.InferOutput<typeof workspaceAddressIdSchema>
export type WorkspaceAddress = v.InferOutput<typeof workspaceAddressSchema>

export interface WorkspaceRootEntry extends FileSystemEntryMetadata {
  workspaceAddress: WorkspaceAddress
}
