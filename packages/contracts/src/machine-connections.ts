import * as v from 'valibot'
import { healthDescriptorSchema } from './health'
import { machineNameSchema } from './machines'

/**
 * A failure as the catalog phrased it: the code names it, `fix` is what the user does next.
 * `action` is set only when the server decided installing its release would clear the failure.
 */
export const connectionErrorSchema = v.object({
  code: v.string(),
  message: v.string(),
  why: v.optional(v.string()),
  fix: v.optional(v.string()),
  action: v.optional(v.picklist(['install', 'update'])),
})

export const machineConnectionStateSchema = v.variant('phase', [
  v.object({ name: machineNameSchema, phase: v.literal('idle') }),
  v.object({ name: machineNameSchema, phase: v.literal('launching') }),
  v.object({ name: machineNameSchema, phase: v.literal('connecting') }),
  v.object({
    name: machineNameSchema,
    phase: v.literal('live'),
    origin: v.string(),
    localPort: v.number(),
    descriptor: healthDescriptorSchema,
  }),
  v.object({
    name: machineNameSchema,
    phase: v.literal('offline'),
    lastError: connectionErrorSchema,
    lastErrorAt: v.number(),
  }),
  v.object({
    name: machineNameSchema,
    phase: v.literal('blocked'),
    lastError: connectionErrorSchema,
    lastErrorAt: v.number(),
  }),
  v.object({
    name: machineNameSchema,
    phase: v.literal('identity-drift'),
    lastError: connectionErrorSchema,
    lastErrorAt: v.number(),
  }),
])

export const machineAuthPromptSchema = v.object({
  id: v.string(),
  name: machineNameSchema,
  prompt: v.string(),
  kind: v.picklist(['secret', 'confirmation']),
})

export const machineEventSchema = v.variant('kind', [
  v.object({ kind: v.literal('state'), state: machineConnectionStateSchema }),
  v.object({ kind: v.literal('auth'), prompt: v.nullable(machineAuthPromptSchema) }),
])

export const machineAuthResponseSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  response: v.nullable(v.pipe(v.string(), v.maxLength(16_384))),
})

export type ConnectionError = v.InferOutput<typeof connectionErrorSchema>
export type MachineConnectionState = v.InferOutput<typeof machineConnectionStateSchema>
export type MachineAuthPrompt = v.InferOutput<typeof machineAuthPromptSchema>
export type MachineEvent = v.InferOutput<typeof machineEventSchema>
