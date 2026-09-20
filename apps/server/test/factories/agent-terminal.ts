import { tmpdir } from 'node:os'
import type { ProviderHistoryMessage } from '../../src/provider/types'
import { createInternalError } from '../../src/observability/structured-errors'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import {
  providerInstanceIdSchema,
  sessionIdSchema,
  providerDriverKindSchema,
} from '@workspace/contracts'
import { closeApp, createApp, orchestrationForApp } from '../../src/app'
import { createMetadataDatabase } from '../../src/db/client'
import {
  MockProviderAdapter,
  MOCK_ADAPTER_CAPABILITIES,
  type MockProviderAdapterOptions,
} from '../../src/provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'
import type { ProviderDriver } from '../../src/provider/driver'
import { testSettingsOptions } from '../../src/settings/testing'
import { createFakePtyFactory } from './terminal'
import { createInProcessTerminalSocket } from '../terminal-socket'

export async function createAgentTerminalFixture(
  options: {
    pty?: Parameters<typeof createFakePtyFactory>[0]
    driverKind?: 'claude' | 'codex'
    provider?: Pick<
      MockProviderAdapterOptions,
      'beforeComplete' | 'stopError' | 'operationTimeoutMs'
    >
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-agent-terminal-'))
  const databasePath = path.join(root, 'runtime.sqlite')
  let handle = createMetadataDatabase({ databasePath })
  const driverKind = v.parse(providerDriverKindSchema, options.driverKind ?? 'claude')
  const instanceId = v.parse(providerInstanceIdSchema, 'terminal-account')
  const sessionId = v.parse(sessionIdSchema, '90b2d10b-4b28-451b-b445-33a76fd9189a')
  const providerOptions = {
    ...options.provider,
    driverKind,
    providerInstanceId: instanceId,
  }
  let adapter = new HistoryProviderAdapter(providerOptions)
  const driver: ProviderDriver<null> = {
    capabilities: { ...MOCK_ADAPTER_CAPABILITIES, multiInstance: true },
    credentialPaths: () => [],
    create: async () => ({ adapter, dispose: () => adapter.stopAll() }),
    defaultConfig: () => null,
    displayName: 'Terminal account',
    driverKind,
    environment: () => [{ name: 'CLAUDE_CONFIG_DIR', value: path.join(root, 'account') }],
    parseConfig: () => null,
  }
  let registry = new ProviderAdapterRegistry({ drivers: [driver] })
  const instanceConfig = [
    {
      driverKind,
      providerInstanceId: instanceId,
      binaryPath: '/configured/claude',
      environment: [{ name: 'TERMINAL_ACCOUNT_MARKER', value: 'private-account' }],
    },
  ]
  await registry.reconcile(instanceConfig)
  const pty = createFakePtyFactory(options.pty)
  const openApp = () =>
    createApp({
      workspaceRoot: root,
      watch: false,
      auth: { allowedOrigins: ['platform-tui://local'] },
      metadataDatabase: handle,
      settings: testSettingsOptions(root),
      workspaceEditJournalRoot: path.join(root, 'journals'),
      terminal: { ptyFactory: pty.factory },
      orchestration: {
        database: handle.db,
        providerAdapterRegistry: registry,
        providerRuntime: true,
        attachmentsDir: path.join(root, 'attachments'),
      },
    })
  let app = openApp()
  let engine = orchestrationForApp(app)
  const receipt = await engine.dispatchClientCommand({
    type: 'project.create',
    commandId: 'terminal-project',
    workspaceRoot: root,
    title: 'Terminal fixture',
    defaultModelSelection: null,
  })
  if (!receipt.result) throw new TypeError('Registration must return a checkout')
  const worktreeId = receipt.result.worktreeId
  const modelSelection = { providerInstanceId: instanceId, model: 'gpt-5.5' }
  await engine.dispatchClientCommand({
    type: 'session.create',
    commandId: 'terminal-session',
    sessionId,
    worktreeTarget: { kind: 'current', worktreeId },
    title: 'Terminal conversation',
    modelSelection,
  })
  let turns = 0
  return {
    get app() {
      return app
    },
    get engine() {
      return engine
    },
    get database() {
      return handle.db
    },
    pty,
    get adapter() {
      return adapter
    },
    get registry() {
      return registry
    },
    root,
    worktreeId,
    projectId: receipt.result.projectId,
    sessionId,
    instanceId,
    socket: (terminalId = 'viewer', selectedWorktree = worktreeId, selectedSession = sessionId) =>
      createInProcessTerminalSocket(
        app,
        { worktreeId: selectedWorktree, agentSessionId: selectedSession, terminalId },
        'platform-tui://local',
      ),
    async turn() {
      turns += 1
      return engine.dispatchClientCommand({
        type: 'session.turn.start',
        commandId: `terminal-turn-${turns}`,
        sessionId,
        turnId: `turn-${turns}`,
        modelSelection,
        message: { messageId: `message-${turns}`, role: 'user', text: 'hello', attachments: [] },
      })
    },
    async restart() {
      await closeApp(app)
      handle.close()
      handle = createMetadataDatabase({ databasePath })
      const history = adapter.history
      const historyError = adapter.historyError
      adapter = new HistoryProviderAdapter(providerOptions)
      adapter.history = history
      adapter.historyError = historyError
      registry = new ProviderAdapterRegistry({ drivers: [driver] })
      await registry.reconcile(instanceConfig)
      app = openApp()
      engine = orchestrationForApp(app)
      await engine.ready
    },
    async close() {
      await closeApp(app)
      handle.close()
      await rm(root, { force: true, recursive: true })
    },
  }
}

class HistoryProviderAdapter extends MockProviderAdapter {
  history: ProviderHistoryMessage[] = []
  historyError: string | null = null
  historyReadGate: Promise<void> | null = null

  async readSessionHistory() {
    await this.historyReadGate
    if (this.historyError) throw createInternalError(this.historyError)
    return this.history
  }
}
