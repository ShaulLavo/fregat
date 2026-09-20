import * as v from 'valibot'
import type { ProviderApprovalDecision, ProviderApprovalOption } from '@workspace/contracts'

const nullableText = v.nullish(v.string())
const metadataSchema = v.object({
  app: nullableText,
  app_name: nullableText,
  appName: nullableText,
  connector_name: nullableText,
  connectorName: nullableText,
  allowPersistentApproval: v.nullish(v.boolean()),
  persist: v.nullish(v.union([v.string(), v.array(v.string())])),
  target: v.nullish(v.object({ app: nullableText, name: nullableText })),
  tool_params: v.nullish(v.object({ app: nullableText, app_name: nullableText })),
})
const fieldSchema = v.object({
  type: nullableText,
  title: nullableText,
  description: nullableText,
  default: v.optional(v.unknown()),
  enum: v.nullish(v.array(v.string())),
  enumNames: v.nullish(v.array(v.string())),
  oneOf: v.nullish(v.array(v.object({ const: v.string(), title: nullableText }))),
})
const formSchema = v.object({
  properties: v.optional(v.record(v.string(), fieldSchema)),
  required: v.nullish(v.array(v.string())),
})
const requestSchema = v.object({
  mode: v.optional(v.picklist(['form', 'url'])),
  message: v.string(),
  serverName: v.string(),
  requestedSchema: v.optional(v.unknown()),
  _meta: v.optional(v.unknown()),
})
type Field = v.InferOutput<typeof fieldSchema>
type PersistenceDecision = Extract<ProviderApprovalDecision, 'acceptForSession' | 'acceptAlways'>
export type ElicitationResponse =
  | { action: 'decline' | 'cancel' }
  | {
      action: 'accept'
      content?: Record<string, unknown>
      _meta?: { persist: 'session' | 'always' }
    }
export type CodexElicitation = {
  detail: string
  options: readonly ProviderApprovalOption[]
  responses: ReadonlyMap<ProviderApprovalDecision, ElicitationResponse>
}

function persistenceDecision(value: string): PersistenceDecision | null {
  const normalized = value.toLowerCase()
  if (normalized.includes('session')) return 'acceptForSession'
  if (/always|permanent|forever|persistent/.test(normalized)) return 'acceptAlways'
  return null
}

function fieldOptions(field: Field) {
  if (field.oneOf)
    return field.oneOf.map((option) => ({ value: option.const, label: option.title }))
  return (field.enum ?? []).map((value, index) => ({ value, label: field.enumNames?.[index] }))
}

function isPersistenceField(key: string, field: Field) {
  return (
    key.toLowerCase() === 'persist' ||
    persistenceDecision(key) !== null ||
    persistenceDecision(field.title ?? '') !== null ||
    persistenceDecision(field.description ?? '') !== null
  )
}

function fieldValue(key: string, field: Field, decision: ProviderApprovalDecision) {
  const persistent = decision === 'acceptForSession' || decision === 'acceptAlways'
  const chosen = fieldOptions(field).find((option) =>
    persistent
      ? persistenceDecision(option.value) === decision
      : /once|accept|approve|allow/i.test(option.value) &&
        persistenceDecision(option.value) === null,
  )
  if (chosen) return chosen.value
  if (field.type === 'boolean' && isPersistenceField(key, field)) return decision === 'acceptAlways'
  return field.default ?? undefined
}

function responseFor(
  form: v.InferOutput<typeof formSchema> | undefined,
  decision: ProviderApprovalDecision,
): ElicitationResponse {
  if (decision === 'decline' || decision === 'cancel') return { action: decision }
  const content: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(form?.properties ?? {})) {
    const value = fieldValue(key, field, decision)
    if (value !== undefined) content[key] = value
  }
  if (form?.required?.some((key) => !Object.hasOwn(content, key))) return { action: 'decline' }
  const response: ElicitationResponse = { action: 'accept', ...(form ? { content } : {}) }
  if (decision === 'acceptForSession') response._meta = { persist: 'session' }
  if (decision === 'acceptAlways') response._meta = { persist: 'always' }
  return response
}

function addFieldPersistence(options: Map<PersistenceDecision, string>, key: string, field: Field) {
  for (const option of fieldOptions(field)) {
    const decision = persistenceDecision(option.value)
    if (decision) options.set(decision, option.label ?? '')
  }
  if (field.type === 'boolean' && isPersistenceField(key, field)) {
    options.set('acceptAlways', field.title ?? '')
  }
}

export function parseCodexElicitation(params: unknown): CodexElicitation | null {
  const request = v.parse(requestSchema, params)
  if (request.mode === 'url') return null
  const parsedForm = v.safeParse(formSchema, request.requestedSchema)
  // Codex's pinned runtime accepts unknown schemas without form content.
  const form = parsedForm.success ? parsedForm.output : undefined
  const accepted = responseFor(form, 'accept')
  if (accepted.action !== 'accept') return null
  const parsedMetadata = v.safeParse(metadataSchema, request._meta)
  const metadata = parsedMetadata.success ? parsedMetadata.output : undefined
  const appName =
    metadata?.app_name ??
    metadata?.appName ??
    metadata?.app ??
    metadata?.target?.app ??
    metadata?.target?.name ??
    metadata?.tool_params?.app_name ??
    metadata?.tool_params?.app ??
    request.message.match(/^Allow ChatGPT to use (.+?)\?$/i)?.[1] ??
    metadata?.connector_name ??
    metadata?.connectorName ??
    request.serverName
  const persistence = new Map<PersistenceDecision, string>()
  const values = metadata?.persist
  for (const value of typeof values === 'string' ? [values] : (values ?? [])) {
    const decision = persistenceDecision(value)
    if (decision) persistence.set(decision, '')
  }
  if (metadata?.allowPersistentApproval) persistence.set('acceptAlways', '')
  for (const [key, field] of Object.entries(form?.properties ?? {}))
    addFieldPersistence(persistence, key, field)
  const options: ProviderApprovalOption[] = [
    { decision: 'cancel', label: 'Cancel' },
    { decision: 'decline', label: 'Decline' },
  ]
  const responses = new Map<ProviderApprovalDecision, ElicitationResponse>([
    ['cancel', { action: 'cancel' }],
    ['decline', { action: 'decline' }],
    ['accept', accepted],
  ])
  addPersistenceOption(
    'acceptForSession',
    'Always allow this session',
    form,
    persistence,
    options,
    responses,
  )
  addPersistenceOption('acceptAlways', 'Always allow', form, persistence, options, responses)
  options.push({ decision: 'accept', label: 'Approve' })
  return { detail: `${appName}\n${request.message}`, options, responses }
}

function addPersistenceOption(
  decision: PersistenceDecision,
  fallbackLabel: string,
  form: v.InferOutput<typeof formSchema> | undefined,
  persistence: ReadonlyMap<PersistenceDecision, string>,
  options: ProviderApprovalOption[],
  responses: Map<ProviderApprovalDecision, ElicitationResponse>,
) {
  if (!persistence.has(decision)) return
  const response = responseFor(form, decision)
  if (response.action !== 'accept') return
  options.push({ decision, label: persistence.get(decision) || fallbackLabel })
  responses.set(decision, response)
}
