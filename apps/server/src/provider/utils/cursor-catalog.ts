import * as v from 'valibot'
import type { ProviderModel, ProviderOptionDescriptor } from '@workspace/contracts'
import { AcpPeer, type AcpPeerInput } from '../acp/peer'
import { initializePeer } from '../acp/session'
import { acpErrors } from '../acp/structured-errors'

export const cursorClientCapabilities = { _meta: { parameterizedModelPicker: true } }

const text = v.pipe(v.string(), v.minLength(1))
const choiceSchema = v.object({ value: text, name: text })
const groupSchema = v.object({ group: text, name: text, options: v.array(choiceSchema) })
const optionBase = { id: text, name: text, description: v.optional(v.nullable(v.string())) }
// Cursor advertises ACP select groups and boolean options through its native catalogue.
const optionSchema = v.variant('type', [
  v.object({
    ...optionBase,
    type: v.literal('select'),
    currentValue: text,
    options: v.union([v.array(choiceSchema), v.array(groupSchema)]),
  }),
  v.object({ ...optionBase, type: v.literal('boolean'), currentValue: v.boolean() }),
])
const catalogSchema = v.object({
  models: v.array(
    v.object({ value: text, name: text, configOptions: v.optional(v.array(optionSchema), []) }),
  ),
})

export function cursorAuthentication(methods: readonly { id: string }[]) {
  return methods.find((method) => method.id === 'cursor_login')?.id ?? methods[0]?.id
}

export async function readCursorCatalog(
  input: Pick<AcpPeerInput, 'executable' | 'args' | 'cwd' | 'env'> & {
    operationTimeoutMs: () => number
  },
): Promise<ProviderModel[]> {
  const peer = new AcpPeer(input)
  const signal = AbortSignal.timeout(input.operationTimeoutMs())
  try {
    await initializePeer(peer, {
      signal,
      clientCapabilities: cursorClientCapabilities,
      authenticate: cursorAuthentication,
    })
    const catalog = v.parse(
      catalogSchema,
      await peer.request('cursor/list_available_models', {}, signal),
    )
    return catalog.models.map((model) => ({
      slug: model.value,
      name: model.name,
      isCustom: false,
      capabilities: model.configOptions.length
        ? { optionDescriptors: model.configOptions.map(optionDescriptor) }
        : null,
    }))
  } catch (error) {
    if (v.isValiError(error))
      throw acpErrors.PROTOCOL({ internal: { reason: 'cursor-catalog-response' } })
    throw error
  } finally {
    await peer.dispose()
  }
}

function optionDescriptor(option: v.InferOutput<typeof optionSchema>): ProviderOptionDescriptor {
  const base = {
    id: option.id,
    label: option.name,
    ...(option.description ? { description: option.description } : {}),
  }
  if (option.type === 'boolean')
    return { ...base, type: 'boolean', currentValue: option.currentValue }
  const choices = option.options.flatMap((choice) =>
    'options' in choice ? choice.options : [choice],
  )
  return {
    ...base,
    type: 'select',
    currentValue: option.currentValue,
    options: choices.map((choice) => ({
      id: choice.value,
      label: choice.name,
      isDefault: choice.value === option.currentValue,
    })),
  }
}
