import * as v from 'valibot'
import { healthDescriptorSchema } from './health'
import { machineNameSchema } from './machines'

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
    lastError: v.string(),
    lastErrorAt: v.number(),
  }),
  v.object({
    name: machineNameSchema,
    phase: v.literal('blocked'),
    lastError: v.string(),
    lastErrorAt: v.number(),
  }),
  v.object({
    name: machineNameSchema,
    phase: v.literal('identity-drift'),
    lastError: v.string(),
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

export type MachineConnectionState = v.InferOutput<typeof machineConnectionStateSchema>
export type MachineAuthPrompt = v.InferOutput<typeof machineAuthPromptSchema>
export type MachineEvent = v.InferOutput<typeof machineEventSchema>
