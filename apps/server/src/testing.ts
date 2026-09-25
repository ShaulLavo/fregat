/**
 * Runtime entry point for test harnesses that drive the real server in-process.
 *
 * The package root (`server`) stays type-only so application code can never
 * accidentally import the Bun-native runtime (bun:sqlite, Bun.spawn). Tests opt
 * in explicitly through `server/testing`, and run under the Bun runtime
 * (`bun --bun vitest`) where those Bun APIs resolve.
 */
export { closeApp, createApp, orchestrationForApp, machinesForApp } from './app'
export type { App, AppOptions } from './app'
export { createMetadataDatabase } from './db/client'
export { migratePlatformDatabase } from './db/migrations'
export { FontCatalogService } from './fonts/catalog'
export { MockProviderAdapter } from './provider/adapters/mock'
export { ProviderAdapterRegistry } from './provider/provider-adapter-registry'
export { nodeWorkspaceEditFileSystemDriver } from './fs/workspace-edit-journal'
export type { WorkspaceEditFileSystemDriver } from './fs/workspace-edit-journal'
export type { MetadataDatabaseHandle, PlatformDatabase } from './db/client'

export { testSettingsOptions, type TestSettingsOverrides } from './settings/testing'
export { runGit, type GitRunOptions, type GitRunResult } from './testing/git'

export { OrchestrationEventStore } from './orchestration/event-store'
export { ProviderRuntimeIngestion } from './orchestration/provider-runtime-ingestion'
export type { ProviderRuntimeEvent } from './provider/types'
export {
  projectIdForRepository,
  repositoryKey,
  worktreeIdForCheckout,
} from './orchestration/utils/repository-ids'
export type { ProviderDiscoveredSession, ProviderSessionDiscoveryInput } from './provider/types'
export { LspSessionPool } from './lsp/proxy-session'
export { spawnTypeScript } from './lsp/typescript/runtime'
export type { LspProxyClientSession } from './lsp/proxy-session'
export type { TerminalPtyFactory } from './terminal/service'

export { LogReaderService } from './observability/log-reader'
