import * as v from 'valibot'
import type { ProviderApprovalDecision, ProviderApprovalOption } from '@workspace/contracts'

const nullableText = v.nullish(v.string())
// Keys and values declared in codex-rs/protocol/src/mcp_approval_meta.rs.
const metadataSchema = v.object({
  connector_name: nullableText,
  persist: v.nullish(v.union([v.string(), v.array(v.unknown())])),
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
type Form = v.InferOutput<typeof formSchema>
type AcceptDecision = Extract<
  ProviderApprovalDecision,
  'accept' | 'acceptForSession' | 'acceptAlways'
>
type PersistenceDecision = Exclude<AcceptDecision, 'accept'>
type ElicitationResponse =
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

// Exact values only: an unrecognized value grants no persistence, never a guessed one.
const persistValues: Readonly<Record<PersistenceDecision, 'session' | 'always'>> = {
  acceptForSession: 'session',
  acceptAlways: 'always',
}
// t3code's rule for the one-time answer. The persistence words only ever exclude, so a
// one-time approval can never send a value like `allow_always`.
const ONE_TIME_VALUE = /once|accept|approve|allow/i
const PERSISTENT_WORD = /session|always|permanent|forever|persistent/i

function fieldOptions(field: Field) {
  if (field.oneOf)
    return field.oneOf.map((option) => ({ value: option.const, label: option.title }))
  return (field.enum ?? []).map((value, index) => ({ value, label: field.enumNames?.[index] }))
}

function optionFor(field: Field, decision: AcceptDecision) {
  if (decision !== 'accept')
    return fieldOptions(field).find((option) => option.value === persistValues[decision])

  return fieldOptions(field).find(
    (option) => ONE_TIME_VALUE.test(option.value) && !PERSISTENT_WORD.test(option.value),
  )
}

function responseFor(form: Form | undefined, decision: AcceptDecision): ElicitationResponse {
  const content: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(form?.properties ?? {})) {
    const value = optionFor(field, decision)?.value ?? field.default ?? undefined
    if (value !== undefined) content[key] = value
  }
  if (form?.required?.some((key) => !Object.hasOwn(content, key))) return { action: 'decline' }
  const response: ElicitationResponse = { action: 'accept', ...(form ? { content } : {}) }
  if (decision !== 'accept') response._meta = { persist: persistValues[decision] }
  return response
}

function declaredPersistence(persist: string | readonly unknown[] | null | undefined) {
  const values: readonly unknown[] = typeof persist === 'string' ? [persist] : (persist ?? [])
  return new Set(values)
}

function formLabel(form: Form | undefined, decision: AcceptDecision) {
  for (const field of Object.values(form?.properties ?? {})) {
    const label = optionFor(field, decision)?.label
    if (label) return label
  }
  return undefined
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
  const appName = metadata?.connector_name || request.serverName
  const persistence = declaredPersistence(metadata?.persist)
  const options: ProviderApprovalOption[] = [
    { decision: 'cancel', label: 'Cancel' },
    { decision: 'decline', label: 'Decline' },
  ]
  const responses = new Map<ProviderApprovalDecision, ElicitationResponse>([
    ['cancel', { action: 'cancel' }],
    ['decline', { action: 'decline' }],
    ['accept', accepted],
  ])
  const persistenceOptions = [
    ['acceptForSession', 'Always allow this session'],
    ['acceptAlways', 'Always allow'],
  ] as const
  for (const [decision, fallbackLabel] of persistenceOptions) {
    if (!persistence.has(persistValues[decision])) continue
    const response = responseFor(form, decision)
    if (response.action !== 'accept') continue
    options.push({ decision, label: formLabel(form, decision) ?? fallbackLabel })
    responses.set(decision, response)
  }
  options.push({ decision: 'accept', label: 'Approve' })
  return { detail: `${appName}\n${request.message}`, options, responses }
}
