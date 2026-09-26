import * as v from 'valibot'

import { providerInstanceIdSchema } from './chat-ids'
import { providerMcpServerSchema } from './provider'

/** The config scopes Platform writes through the harness: Codex has `user` only. */
export const providerMcpScopeSchema = v.picklist(['user', 'local', 'project'])

/** Reserved for Platform’s own tool endpoint. */
export const RESERVED_MCP_SERVER_NAME = 'platform'

export const providerMcpServerNameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.regex(/^[A-Za-z0-9_-]{1,64}$/, 'Use letters, digits, hyphens and underscores (at most 64).'),
  v.check(
    (name) => name.toLowerCase() !== RESERVED_MCP_SERVER_NAME,
    'The name platform is reserved for Platform’s own tools.',
  ),
)

const stringMapSchema = v.record(v.pipe(v.string(), v.trim(), v.minLength(1)), v.string())

/** A server definition as typed in the add dialog, one shape for both harnesses. */
export const providerMcpDefinitionSchema = v.variant('transport', [
  v.object({
    transport: v.literal('stdio'),
    command: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter the command that starts it.')),
    args: v.array(v.string()),
    env: stringMapSchema,
  }),
  v.object({
    transport: v.literal('http'),
    url: v.pipe(
      v.string(),
      v.trim(),
      v.url('Enter the server address.'),
      v.regex(/^https?:\/\//i, 'Use an HTTP or HTTPS address.'),
    ),
    headers: stringMapSchema,
  }),
])

/** One server of an instance's config, with the file it lives in and the scope Platform can edit. */
export const providerMcpConfigServerSchema = v.object({
  ...providerMcpServerSchema.entries,
  file: v.nullable(v.string()),
  /** Null for plugin, claude.ai and managed servers: their owner edits them. */
  scope: v.nullable(providerMcpScopeSchema),
})

/**
 * The MCP servers an instance's harness would start from `folder`, read by a probe outside any
 * session. `scopes` lists where the add dialog may write for this harness.
 */
export const providerInstanceMcpSchema = v.object({
  folder: v.string(),
  scopes: v.array(providerMcpScopeSchema),
  servers: v.array(providerMcpConfigServerSchema),
})

export const providerInstanceMcpQuerySchema = v.object({
  folder: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
})

export const providerMcpAddBodySchema = v.object({
  name: providerMcpServerNameSchema,
  scope: providerMcpScopeSchema,
  /** The project folder a `local` or `project` server belongs to. */
  folder: v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1))),
  definition: providerMcpDefinitionSchema,
})

export const providerMcpRemoveBodySchema = v.object({
  scope: providerMcpScopeSchema,
  folder: v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1))),
})

/**
 * Copies one server's definition, secrets included, into another instance's config. Without a
 * target scope it lands in the same scope when the target keeps one, else in the target's user config.
 */
export const providerMcpCopyBodySchema = v.object({
  scope: providerMcpScopeSchema,
  folder: v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1))),
  target: v.object({
    providerInstanceId: providerInstanceIdSchema,
    scope: v.optional(providerMcpScopeSchema),
  }),
})

export type ProviderMcpScope = v.InferOutput<typeof providerMcpScopeSchema>
export type ProviderMcpDefinition = v.InferOutput<typeof providerMcpDefinitionSchema>
export type ProviderMcpConfigServer = v.InferOutput<typeof providerMcpConfigServerSchema>
export type ProviderInstanceMcp = v.InferOutput<typeof providerInstanceMcpSchema>
export type ProviderMcpAddBody = v.InferOutput<typeof providerMcpAddBodySchema>
export type ProviderMcpRemoveBody = v.InferOutput<typeof providerMcpRemoveBodySchema>
export type ProviderMcpCopyBody = v.InferOutput<typeof providerMcpCopyBodySchema>
