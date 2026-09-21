import {
  errorNumberField,
  errorStringField,
  isSettingId,
  SETTINGS_OPERATION_KINDS,
  settingsMutationRequestSchema,
  settingsMutationResultSchema,
  settingsRawWriteRequestSchema,
  settingsRawWriteResultSchema,
  settingsSnapshotSchema,
  type SettingId,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import { Elysia } from 'elysia'
import * as v from 'valibot'
import { recordRequestContext } from '../observability'
import { sseResponse, toSse } from '../sse'
import { requestRejection } from './request-rejection'
import type { SettingsStore } from './store'

const targetSchema = v.optional(v.picklist(['user', 'workspace'] as const), 'user')

const rawQuerySchema = v.object({ target: targetSchema })

const OPERATION_KINDS = new Set<string>(SETTINGS_OPERATION_KINDS)

/**
 * Five routes, all GET or POST — the CORS layer allows exactly GET/POST/OPTIONS,
 * so PUT and PATCH fail preflight from the web client.
 *
 * Request bodies are deliberately not validated by Elysia. It collapses any
 * schema failure into its generic VALIDATION code, which would strip the typed
 * `settings.*` error the page actually shows. Route parsing preserves that
 * structured error; the store then checks scope and policy.
 */
export function settingsRoutes(settings: SettingsStore) {
  return new Elysia({ name: 'settings-routes' })
    .get('/settings', () => settings.snapshot(), { response: settingsSnapshotSchema })
    .post(
      '/settings/write',
      ({ body, request }) => {
        recordRequestContext(unparsedMutationContext(body))
        return settings.write(parseRequest(settingsMutationRequestSchema, body), request.signal)
      },
      {
        response: settingsMutationResultSchema,
      },
    )
    .get('/settings/events', ({ request }) =>
      sseResponse(
        toSse(settings.changes(request.signal), {
          event: () => 'settings',
        }),
        request.signal,
      ),
    )
    .get('/settings/raw', ({ query }) => settings.rawLayer(parse(rawQuerySchema, query).target))
    .post(
      '/settings/raw',
      ({ body }) => {
        recordRequestContext(unparsedRawContext(body))
        return settings.writeRaw(parseRequest(settingsRawWriteRequestSchema, body))
      },
      { response: settingsRawWriteResultSchema },
    )
}

function unparsedMutationContext(body: unknown) {
  const operations = isRecord(body) && Array.isArray(body.operations) ? body.operations : []

  return {
    area: 'settings',
    operation: 'write',
    settings: {
      mutationId: safeId(isRecord(body) ? body.mutationId : undefined),
      affectedDomainIds: unique(operations.flatMap(operationAffectedDomainIds)),
      operationKinds: unique(operations.flatMap(operationKind)),
      settingIds: unique(operations.flatMap(operationSettingIds)),
      target: safeTarget(isRecord(body) ? body.target : undefined),
      ...unknownSettingIdsContext(operations),
    },
  }
}

/**
 * `operationSettingIds` filters through `isSettingId`, so a key this build does
 * not register vanishes from the one event that should name it. A client ahead
 * of the server reads as an empty `settingIds` on a rejected write.
 */
function unknownSettingIdsContext(operations: readonly unknown[]) {
  const unknown = unique(operations.flatMap(operationUnknownSettingIds))
  return unknown.length > 0 ? { unknownSettingIds: unknown } : {}
}

function operationUnknownSettingIds(value: unknown): string[] {
  if (!isRecord(value)) return []
  if (value.kind === 'set' && typeof value.key === 'string' && !isSettingId(value.key)) {
    return [safeDomainPart(value.key)]
  }
  if (value.kind !== 'reset' || !Array.isArray(value.keys)) return []

  return value.keys
    .filter((key): key is string => typeof key === 'string' && !isSettingId(key))
    .map(safeDomainPart)
}

function unparsedRawContext(body: unknown) {
  return {
    area: 'settings',
    operation: 'write-raw',
    settings: {
      mutationId: safeId(isRecord(body) ? body.writeId : undefined),
      operationKinds: ['raw.replace'],
      target: safeTarget(isRecord(body) ? body.target : undefined),
    },
  }
}

function operationKind(value: unknown): string[] {
  if (!isRecord(value)) return []

  return typeof value.kind === 'string' && OPERATION_KINDS.has(value.kind) ? [value.kind] : []
}

function operationSettingIds(value: unknown): SettingId[] {
  if (!isRecord(value)) return []
  if (value.kind === 'set' && typeof value.key === 'string' && isSettingId(value.key)) {
    return [value.key]
  }
  if (value.kind === 'reset' && Array.isArray(value.keys)) return value.keys.filter(isSettingId)
  if (value.kind === 'keybinding.set' || value.kind === 'keybinding.remove') {
    return ['keybindings.overrides']
  }
  if (value.kind === 'model.setHidden') return ['models.hidden']
  if (value.kind === 'model.setOrder') return ['models.order']
  if (value.kind === 'provider.setEnabled') return ['providers.instances']

  return []
}

function operationAffectedDomainIds(value: unknown): string[] {
  if (!isRecord(value)) return []
  if (value.kind === 'keybinding.set' || value.kind === 'keybinding.remove') {
    const command = safeDomainPart(value.command)
    return command ? [`command:${command}`] : []
  }
  if (value.kind === 'model.setHidden') return modelDomainIds([value.ref])
  if (value.kind === 'model.setOrder' && Array.isArray(value.order)) {
    return modelDomainIds(value.order)
  }
  if (value.kind !== 'provider.setEnabled') return []

  const provider = safeDomainPart(value.providerInstanceId)
  return provider ? [`provider:${provider}`] : []
}

function modelDomainIds(values: readonly unknown[]) {
  return values.flatMap((value) => {
    if (!isRecord(value)) return []
    const provider = safeDomainPart(value.providerInstanceId)
    const model = safeDomainPart(value.model)
    return provider && model ? [`model:${provider}/${model}`] : []
  })
}

function safeDomainPart(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : ''
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function safeId(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 200) : undefined
}

function safeTarget(value: unknown) {
  return value === 'user' || value === 'workspace' ? value : undefined
}

function parse<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
): v.InferOutput<TSchema> {
  const parsed = v.safeParse(schema, input)
  if (parsed.success) return parsed.output

  throw requestRejection(input, parsed.issues)
}

function parseRequest<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
): v.InferOutput<TSchema> {
  try {
    return parse(schema, input)
  } catch (error) {
    const code = errorStringField(error, 'code')
    const status = errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status')
    recordRequestContext({
      settings: {
        coordinatorWaitMs: 0,
        error: { code, status },
        outcome: 'rejected',
        rebaseAttempts: 0,
      },
    })
    throw error
  }
}
