import {
  interactionModeSchema,
  modelSelectionSchema,
  runtimeModeSchema,
  sessionAgentSchema,
  type ModelSelection,
} from '@workspace/contracts'
import * as v from 'valibot'

export const providerSessionRuntimePayloadSchema = v.object({
  agent: v.optional(sessionAgentSchema),
  cwd: v.optional(v.pipe(v.string(), v.minLength(1))),
  interactionMode: v.optional(interactionModeSchema),
  modelSelection: v.optional(modelSelectionSchema),
  runtimeMode: v.optional(runtimeModeSchema),
  /** MCP servers the owner turned off for this session; every start and resume carries them. */
  mcpOff: v.optional(v.array(v.string())),
})

export type ProviderSessionRuntimePayload = v.InferOutput<
  typeof providerSessionRuntimePayloadSchema
>

export type ProviderRuntimeStartPayload = ProviderSessionRuntimePayload & {
  cwd: string
  modelSelection: ModelSelection
}
