import type { CanUseTool, Options, PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type {
  InteractionMode,
  ModelSelection,
  ProviderInstanceId,
  RuntimeMode,
  SessionId,
} from '@workspace/contracts'
import {
  claudeModelCapabilities,
  ONE_MILLION_CONTEXT_SUFFIX,
  type ClaudeCatalog,
} from './claude-models'
import { claudeReasoningQueryOptions, type ClaudeReasoning } from './claude-reasoning'
import { modelOptionDescriptor, modelOptionValue, modelSelectValue } from './model-options'

/**
 * Pure translation layer between our runtime/interaction modes and the agent
 * SDK's `Options`. Type-only SDK imports on purpose: nothing here may pull in
 * the SDK runtime, or importing it would spawn-check the `claude` binary.
 */

export type ClaudeRuntimeSelection = {
  interactionMode?: InteractionMode
  runtimeMode: RuntimeMode
}

type ClaudePermissionOptions = Pick<Options, 'allowDangerouslySkipPermissions' | 'permissionMode'>

export type ClaudeQueryOptionsInput = ClaudeRuntimeSelection & {
  abortController: AbortController
  canUseTool?: CanUseTool
  cwd: string
  /** Per-instance spawn env. Absent means "inherit the server's env untouched". */
  env?: NodeJS.ProcessEnv
  /** The instance's resolved CLI; without it the SDK runs its bundled one. */
  executablePath: string
  model: string
  /** False keeps isolated utility turns out of the provider's transcript store. */
  persistSession?: boolean
  /** Effort/thinking for this session; absent means "send neither". */
  reasoning?: ClaudeReasoning
  resumeExisting?: boolean
  sessionId: SessionId
  /** The agent definition the main thread runs as (`--agent`). */
  agent?: string
  /** A new session branching off `sourceSessionId`, cut after `resumeSessionAt` when set. */
  fork?: ClaudeForkOptions
}

export type ClaudeForkOptions = {
  resumeSessionAt?: string
  sourceSessionId: SessionId
}

type ClaudeSessionOptions = Pick<
  Options,
  'forkSession' | 'resume' | 'resumeSessionAt' | 'sessionId'
>

export function claudePermissionMode(input: ClaudeRuntimeSelection): PermissionMode {
  if (input.interactionMode === 'plan') return 'plan'
  // 'default' is the only mode that routes every tool call through the
  // `canUseTool` callback. 'dontAsk' looks closer by name but denies anything
  // not pre-approved instead of asking us.
  if (input.runtimeMode === 'approval-required') return 'default'
  if (input.runtimeMode === 'auto-accept-edits') return 'acceptEdits'

  return 'bypassPermissions'
}

/**
 * `permissionMode: 'bypassPermissions'` is rejected by the SDK unless
 * `allowDangerouslySkipPermissions: true` rides along in the same object. The
 * two are only ever produced together, here, so no call site can emit one
 * without the other.
 */
function claudePermissionOptions(input: ClaudeRuntimeSelection): ClaudePermissionOptions {
  const permissionMode = claudePermissionMode(input)
  if (permissionMode !== 'bypassPermissions') return { permissionMode }

  return { allowDangerouslySkipPermissions: true, permissionMode }
}

export function claudeModelId(input: {
  catalog: ClaudeCatalog
  modelSelection: ModelSelection
  providerInstanceId: ProviderInstanceId
}): string {
  // Same instance-mismatch guard as codexModelOptions: a selection aimed at
  // another provider carries none of our model's options, so ignore it wholesale.
  if (input.modelSelection.providerInstanceId !== input.providerInstanceId) {
    return input.catalog.defaultModel
  }

  const model = input.modelSelection.model.trim() || input.catalog.defaultModel
  const descriptor = modelOptionDescriptor(
    claudeModelCapabilities(input.catalog.models, model),
    'contextWindow',
  )
  const selected = modelOptionValue(input.modelSelection.options, 'contextWindow')
  if (modelSelectValue(descriptor, selected) !== '1m') return model
  if (model.endsWith(ONE_MILLION_CONTEXT_SUFFIX)) return model

  return `${model}${ONE_MILLION_CONTEXT_SUFFIX}`
}

/**
 * `resume` and `sessionId` are mutually exclusive unless `forkSession` rides
 * along, which only a fork wants: it keeps our minted id as the Platform and SDK
 * id of the branch. Resuming keeps the id the CLI already persisted; a fresh
 * conversation adopts the id we minted, which is what lets the caller know the
 * session id before the CLI announces it.
 */
function claudeSessionOptions(input: {
  fork?: ClaudeForkOptions
  resumeExisting?: boolean
  sessionId: SessionId
}): ClaudeSessionOptions {
  if (input.fork)
    return {
      forkSession: true,
      resume: input.fork.sourceSessionId,
      sessionId: input.sessionId,
      ...(input.fork.resumeSessionAt ? { resumeSessionAt: input.fork.resumeSessionAt } : {}),
    }
  if (input.resumeExisting) return { resume: input.sessionId }

  return { sessionId: input.sessionId }
}

export function claudeQueryOptions(input: ClaudeQueryOptionsInput): Options {
  return {
    abortController: input.abortController,
    ...(input.agent ? { agent: input.agent } : {}),
    cwd: input.cwd,
    // Without it only SessionStart and Setup hooks report, and a blocking
    // PreToolUse hook would leave no trace of why the agent stopped.
    includeHookEvents: true,
    includePartialMessages: true,
    model: input.model,
    pathToClaudeCodeExecutable: input.executablePath,
    ...(input.persistSession === undefined ? {} : { persistSession: input.persistSession }),
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { preset: 'claude_code', type: 'preset' },
    ...claudeReasoningQueryOptions(input.reasoning ?? {}),
    ...claudePermissionOptions(input),
    ...claudeSessionOptions(input),
    ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
    // Absent `env` makes the CLI inherit process.env untouched, which is what a
    // single-instance install wants. When it is present it carries
    // CLAUDE_CONFIG_DIR for the instance — NEVER an overridden HOME: that
    // relocates the macOS login-keychain lookup ($HOME/Library/Keychains), the
    // CLI cannot find its stored OAuth credentials, and it reports "Not logged in".
    ...(input.env ? { env: input.env } : {}),
  }
}
