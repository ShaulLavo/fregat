import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  Options,
  Query,
  SDKMessage,
  SDKRateLimitInfo,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { ClaudeProviderAdapter } from '../../src/provider/adapters/claude'
import { claudeDriver } from '../../src/provider/drivers/claude'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'
import { ProviderService } from '../../src/provider/provider-service'
import { ProviderSessionDirectory } from '../../src/provider/provider-session-directory'
import { ProviderUsageStore } from '../../src/provider/usage-store'
import type { ProviderRuntimeEvent, ProviderTurnInput } from '../../src/provider/types'
import { createOrchestrationFixture } from './orchestration'
import {
  FAKE_CLAUDE_SESSION_ID,
  FakeClaudeQuery,
  fakeClaudeInit,
  fakeClaudeSuccess,
  signedInClaudeAuth,
} from './fake-claude-query'
import { resolveFakeClaudeExecutable } from './claude-models'

export async function createClaudeUsageLifecycleFixture(env: NodeJS.ProcessEnv = {}) {
  const fixture = await createOrchestrationFixture()
  const registration = await fixture.register()
  assert(registration.result)
  await fixture.createSession(registration.result.worktreeId, FAKE_CLAUDE_SESSION_ID)
  const configDir = path.join(fixture.root, 'claude-account')
  const otherDir = path.join(fixture.root, 'other-account')
  await mkdir(configDir)
  await mkdir(otherDir)
  const providerInstanceId = v.parse(providerInstanceIdSchema, 'claude-fixture')
  const otherId = v.parse(providerInstanceIdSchema, 'claude-other')
  const options: Options[] = []
  const queries: FakeClaudeQuery[] = []
  const prompts: Promise<IteratorResult<SDKUserMessage>>[] = []
  const consumed = new Map<SDKMessage, () => void>()
  const registry = new ProviderAdapterRegistry({
    services: { cwd: fixture.checkout },
    drivers: [
      {
        ...claudeDriver,
        create: async (input) => {
          const adapter = new ClaudeProviderAdapter({
            providerInstanceId: input.providerInstanceId,
            env: input.env,
            attachmentsDir: path.join(fixture.root, 'attachments'),
            projectMcpApprovalsFile: path.join(fixture.root, 'mcp-approvals.json'),
            auth: signedInClaudeAuth(),
            resolveExecutable: resolveFakeClaudeExecutable,
            createQuery: (input) => usageQuery(input, options, queries, prompts, consumed),
          })
          return { adapter, dispose: () => adapter.stopAll() }
        },
      },
    ],
  })
  const environment = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
    'CLAUDE_CODE_USE_MANTLE',
    'CLAUDE_CODE_USE_GATEWAY',
  ].map((name) => ({ name, value: env[name] ?? '' }))
  await registry.reconcile([
    { providerInstanceId, driverKind: claudeDriver.driverKind, config: { configDir }, environment },
    {
      providerInstanceId: otherId,
      driverKind: claudeDriver.driverKind,
      config: { configDir: otherDir },
      environment,
    },
  ])
  const observedAt = new Date(Date.now() - 600_000).toISOString()
  await writeFile(
    path.join(configDir, '.claude.json'),
    JSON.stringify({
      oauthAccount: { accountUuid: 'synthetic-native-account' },
      cachedUsageUtilization: {
        accountUuid: 'synthetic-native-account',
        fetchedAtMs: Date.parse(observedAt),
        utilization: { five_hour: { utilization: 23, resets_at: null } },
      },
    }),
  )
  const store = new ProviderUsageStore(registry)
  await store.refresh()
  const directory = new ProviderSessionDirectory(fixture.database)
  const service = new ProviderService({ adapterRegistry: registry, sessionDirectory: directory })
  const events: ProviderRuntimeEvent[] = []
  service.subscribeRuntimeEvents((event) => {
    events.push(event)
    store.accept(event)
  })
  const input: ProviderTurnInput = {
    attachments: [],
    cwd: fixture.checkout,
    interactionMode: DEFAULT_INTERACTION_MODE,
    messageText: 'Fixture-only native subscription proof',
    modelSelection: { providerInstanceId, model: 'claude-opus-5' },
    providerInstanceId,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    sessionId: v.parse(sessionIdSchema, FAKE_CLAUDE_SESSION_ID),
    runtimeEpoch: 'fixture-current-epoch',
    turnId: v.parse(turnIdSchema, 'fixture-turn'),
  }
  await service.ensureRuntime({
    providerInstanceId,
    runtimeMode: input.runtimeMode,
    runtimePayload: {
      cwd: input.cwd,
      interactionMode: input.interactionMode,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
    },
    sessionId: input.sessionId,
    runtimeEpoch: input.runtimeEpoch,
  })
  const turn = service.sendTurn(input)
  void turn.catch(() => undefined)
  await prompts.at(-1)
  const query = queries.at(-1)!
  return {
    events,
    input,
    query,
    options,
    registry,
    service,
    store,
    directory,
    configDir,
    observedAt,
    providerInstanceId,
    otherId,
    init: (apiKeySource: string) =>
      query.emit({ ...fakeClaudeInit(), apiKeySource, cwd: fixture.checkout } as SDKMessage),
    rateLimit: async (
      info: SDKRateLimitInfo = { rateLimitType: 'five_hour', status: 'allowed' },
    ) => {
      const frame: SDKMessage = {
        type: 'rate_limit_event',
        session_id: input.sessionId,
        uuid: '55555555-5555-4555-8555-555555555555',
        rate_limit_info: info,
      }
      const settled = new Promise<void>((resolve) => consumed.set(frame, resolve))
      query.emit(frame)
      await settled
      await service.drainRuntimeEvents()
    },
    close: async () => {
      query.emit(fakeClaudeInit())
      query.emit(fakeClaudeSuccess())
      await turn.catch(() => undefined)
      await service.shutdown()
      await store.close()
      await registry.dispose()
      await fixture.close()
    },
  }
}

function usageQuery(
  input: { options: Options; prompt: AsyncIterable<SDKUserMessage> },
  options: Options[],
  queries: FakeClaudeQuery[],
  prompts: Promise<IteratorResult<SDKUserMessage>>[],
  consumed: Map<SDKMessage, () => void>,
): Query {
  const query = Object.assign(new FakeClaudeQuery(), {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
      rate_limits_available: false,
      rate_limits: null,
      subscription_type: null,
    }),
  })
  const iterator = query[Symbol.asyncIterator].bind(query)
  query[Symbol.asyncIterator] = () => {
    const stream = iterator()
    let previous: SDKMessage | undefined
    return {
      next: async () => {
        // The next pull proves the adapter finished handling the previous SDK frame.
        if (previous) {
          consumed.get(previous)?.()
          consumed.delete(previous)
        }
        const item = await stream.next()
        previous = item.done ? undefined : item.value
        return item
      },
    }
  }
  if (!input.options.sessionId && !input.options.resume) return query as unknown as Query
  prompts.push(input.prompt[Symbol.asyncIterator]().next())
  options.push(input.options)
  queries.push(query)
  input.options.abortController?.signal.addEventListener('abort', () => query.finish(), {
    once: true,
  })
  return query as unknown as Query
}
