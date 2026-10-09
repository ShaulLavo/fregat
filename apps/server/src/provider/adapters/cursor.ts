import { readFile } from 'node:fs/promises'
import * as v from 'valibot'
import type { ProviderInstanceSettings, ProviderModel } from '@workspace/contracts'
import { attachmentFilePath, defaultAttachmentsDir } from '../../attachments/store'
import { AcpProviderAdapter, type AcpExtensionClient } from '../acp/adapter'
import type { AcpContent } from '../acp/session'
import { acpErrors } from '../acp/structured-errors'
import type { ProviderTurnInput } from '../types'
import { cursorAuthentication, cursorClientCapabilities } from '../utils/cursor-catalog'

const questionsSchema = v.object({
  toolCallId: v.string(),
  questions: v.array(
    v.object({
      id: v.string(),
      prompt: v.string(),
      allowMultiple: v.optional(v.boolean()),
      options: v.array(v.object({ id: v.string(), label: v.string() })),
    }),
  ),
})
const todosSchema = v.object({
  toolCallId: v.string(),
  merge: v.boolean(),
  todos: v.array(
    v.object({
      content: v.optional(v.string()),
      title: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  ),
})

const planSchema = v.object({
  toolCallId: v.string(),
  plan: v.string(),
  todos: todosSchema.entries.todos,
})

export type CursorAdapterOptions = {
  settings: ProviderInstanceSettings
  binaryPath: string
  env: NodeJS.ProcessEnv
  operationTimeoutMs: () => number
  catalog?: () => Promise<ProviderModel[]>
}

export class CursorProviderAdapter extends AcpProviderAdapter {
  constructor(options: CursorAdapterOptions) {
    super({
      ...options,
      args: (input) => (input.runtimeMode === 'full-access' ? ['--force'] : []).concat(['acp']),
      resumeMethod: 'load',
      defaultModel: 'auto',
      steering: 'parallel',
      authenticate: cursorAuthentication,
      clientCapabilities: cursorClientCapabilities,
      configure: async (session, input, signal) => {
        await session.request('session/set_model', { modelId: input.modelSelection.model }, signal)
        const modes = v.safeParse(
          v.object({
            modes: v.object({
              availableModes: v.array(v.object({ id: v.string(), name: v.string() })),
            }),
          }),
          session.configuration,
        )
        if (modes.success) {
          const available = modes.output.modes.availableModes
          const isPlan = (mode: { id: string; name: string }) =>
            /plan/i.test(`${mode.id} ${mode.name}`)
          const selected =
            input.interactionMode === 'plan'
              ? available.find(isPlan)
              : available.find((mode) => !isPlan(mode))
          if (selected) await session.request('session/set_mode', { modeId: selected.id }, signal)
        }
        for (const [configId, value] of Object.entries(input.modelSelection.options ?? {})) {
          if (typeof value !== 'string' && typeof value !== 'boolean') continue
          await session.request('session/set_config_option', { configId, value }, signal)
        }
      },
      prompt: cursorPrompt,
      request: cursorRequest,
      notification: cursorNotification,
    })
  }
}

async function cursorPrompt(input: ProviderTurnInput): Promise<readonly AcpContent[]> {
  const content: AcpContent[] = [{ type: 'text', text: input.messageText }]
  const root = input.attachmentsDir ?? defaultAttachmentsDir()
  for (const attachment of input.attachments) {
    const filePath = attachmentFilePath({ attachmentsDir: root, attachment })
    if (!filePath) throw acpErrors.PROTOCOL({ internal: { reason: 'attachment-type' } })
    if (attachment.type === 'image') {
      const data = await readFile(filePath)
      content.push({ type: 'image', data: data.toString('base64'), mimeType: attachment.mimeType })
      continue
    }
    content.push({ type: 'text', text: `Attached file ${attachment.name}: ${filePath}` })
  }
  return content
}

async function cursorRequest(
  method: string,
  params: unknown,
  client: AcpExtensionClient,
): Promise<unknown> {
  if (method === 'cursor/ask_question') {
    const parsed = v.safeParse(questionsSchema, params)
    if (!parsed.success) throw acpErrors.PROTOCOL({ internal: { reason: 'cursor-question' } })
    const questions = parsed.output.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      header: 'Question',
      answerKind: question.allowMultiple ? ('multi-select' as const) : ('single-select' as const),
      options: question.options.map((option) => ({ value: option.id, label: option.label })),
      allowOther: question.options.length === 0,
      secret: false,
    }))
    return { answers: await client.ask(questions) }
  }
  if (method === 'cursor/create_plan') {
    const plan = v.safeParse(planSchema, params)
    if (!plan.success) throw acpErrors.PROTOCOL({ internal: { reason: 'cursor-plan' } })
    client.publish({
      ...client.eventBase(),
      type: 'proposed-plan.upsert',
      turnId: client.eventBase().turnId ?? null,
      planMarkdown: plan.output.plan,
    })
    return { accepted: true }
  }
  throw acpErrors.PROTOCOL({ internal: { reason: 'cursor-method', operation: method } })
}

function cursorNotification(method: string, params: unknown, client: AcpExtensionClient) {
  if (method !== 'cursor/update_todos') return
  const parsed = v.safeParse(todosSchema, params)
  if (!parsed.success) return
  const plan = parsed.output.todos.flatMap((todo) => {
    const step = todo.content?.trim() || todo.title?.trim()
    if (!step) return []
    let status: 'pending' | 'inProgress' | 'completed' = 'pending'
    if (todo.status === 'in_progress' || todo.status === 'inProgress') status = 'inProgress'
    if (todo.status === 'completed' || todo.status === 'done') status = 'completed'
    return [{ step, status }]
  })
  client.publish({ ...client.eventBase(), type: 'turn.plan.updated', payload: { plan } })
}
