import type { EnvironmentId, ProviderInstanceId, SessionId } from '@workspace/contracts'

export const attachmentQueryKeys = {
  text: (url: string) => ['chat-attachment-text', url] as const,
  capabilities: (environmentId: string) =>
    ['chat', 'attachment-capabilities', environmentId] as const,
}

export const providerAuthKeys = {
  all: ['providers', 'auth'] as const,
  attempt: (providerInstanceId: ProviderInstanceId, attemptId: string) =>
    [...providerAuthKeys.all, providerInstanceId, 'attempt', attemptId] as const,
  status: (providerInstanceId: ProviderInstanceId) =>
    [...providerAuthKeys.all, providerInstanceId] as const,
}

export const providerUsageKeys = {
  all: ['providers', 'usage'] as const,
}

export const providerCommandCatalogKeys = {
  all: ['providers', 'commands'] as const,
  catalog: (providerInstanceId: ProviderInstanceId, cwd: string | null) =>
    [...providerCommandCatalogKeys.all, providerInstanceId, cwd ?? 'no-cwd'] as const,
}

export const projectEntryQueryKeys = {
  all: ['chat-project-entries'] as const,
  search: (rootPath: string, query: string, limit: number) =>
    [...projectEntryQueryKeys.all, rootPath, query, limit] as const,
}

export const sessionTranscriptKeys = {
  transcript: (environmentId: EnvironmentId, sessionId: SessionId) =>
    ['chat', 'session-transcript', environmentId, sessionId] as const,
}

export const backgroundTaskKeys = {
  roster: (environmentId: EnvironmentId, sessionId: SessionId) =>
    ['chat', 'background-tasks', environmentId, sessionId] as const,
}
