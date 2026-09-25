import { resolveSessionTitleLinks } from './title-links'
import { sanitizeSessionTitle } from './title-normalization'
import { sessionTitlePrompt } from './title-prompt'
import { defineErrorCatalog } from 'evlog'
import type { ChatAttachment, ModelSelection, ProviderSnapshot } from '@workspace/contracts'
import type { ProviderService } from '../provider/provider-service'

const DEFAULT_TITLE_MODELS: Readonly<Record<string, string>> = {
  codex: 'gpt-5.6-luna',
  claude: 'claude-haiku-4-5',
  antigravity: 'antigravity-default',
  cursor: 'composer-2',
  opencode: 'openai/gpt-5',
  grok: 'grok-build',
}
const DEFAULT_PROVIDER_ORDER = ['codex', 'claude', 'cursor', 'grok', 'opencode', 'antigravity']

const errors = defineErrorCatalog('session-title', {
  INVALID_RESPONSE: {
    status: 502,
    message: 'The provider returned an invalid session title.',
    why: 'A title must be a nonempty JSON title string.',
    fix: 'Retry title generation.',
  },
})

export function selectTitleModel(
  configured: ModelSelection,
  providers: readonly ProviderSnapshot[],
) {
  if (
    providers.some(
      (provider) =>
        provider.providerInstanceId === configured.providerInstanceId && provider.enabled,
    )
  )
    return configured
  const fallback = DEFAULT_PROVIDER_ORDER.map((id) =>
    providers.find((provider) => provider.providerInstanceId === id && provider.enabled),
  ).find((provider) => provider !== undefined)
  if (!fallback) return configured
  return {
    providerInstanceId: fallback.providerInstanceId,
    model: DEFAULT_TITLE_MODELS[fallback.driverKind] ?? 'gpt-5.6-luna',
  }
}

export async function generateSessionTitle(
  service: ProviderService,
  input: {
    cwd: string
    attachmentsDir: string
    message: string
    attachments: readonly ChatAttachment[]
    modelSelection: ModelSelection
    previousTitle?: string
    signal: AbortSignal
  },
) {
  const linkedContext = await resolveSessionTitleLinks(input)
  const result = await service.generateText({
    modelSelection: input.modelSelection,
    purpose: 'title',
    signal: input.signal,
    attachments: input.attachments,
    attachmentsDir: input.attachmentsDir,
    messageText: sessionTitlePrompt(input.message, input.previousTitle, linkedContext),
  })
  const text = result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw errors.INVALID_RESPONSE()
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('title' in parsed) ||
    typeof parsed.title !== 'string'
  )
    throw errors.INVALID_RESPONSE()
  return {
    title: sanitizeSessionTitle(parsed.title),
    needsRefinement: 'needsRefinement' in parsed && parsed.needsRefinement === true,
  }
}
