export function readCaches() {
  type AnyQuery = {
    queryKey: unknown
    state: { status: string; fetchStatus: string; dataUpdatedAt: number }
    isStale(): boolean
    getObserversCount(): number
  }
  type AnyMutation = {
    options: { mutationKey?: unknown; scope?: { id: string } }
    state: { status: string; variables: unknown }
  }
  type AnyClient = {
    getQueryCache(): { getAll(): AnyQuery[] }
    getMutationCache(): { getAll(): AnyMutation[] }
  }
  const registry = globalThis as {
    __fregatQueryClients?: Map<string, AnyClient>
    __fregatResourceQueryClient?: AnyClient
  }
  const clients = [...(registry.__fregatQueryClients ?? new Map<string, AnyClient>())].map(
    ([origin, client]) => ({ scope: 'environment', label: origin, origin, client }),
  )
  if (registry.__fregatResourceQueryClient)
    clients.push({
      scope: 'resources',
      label: 'Browser resources',
      origin: '',
      client: registry.__fregatResourceQueryClient,
    })
  const compact = (value: unknown) => {
    const text = JSON.stringify(value) ?? String(value)
    return text.length > 80 ? `${text.slice(0, 77)}…` : text
  }
  return clients.map(({ scope, label, origin, client }) => ({
    scope,
    label,
    origin: origin || null,
    queries: client
      .getQueryCache()
      .getAll()
      .map((query) => ({
        key: compact(query.queryKey),
        status: query.state.status,
        fetchStatus: query.state.fetchStatus,
        stale: query.isStale(),
        observers: query.getObserversCount(),
        updatedAgoMs: query.state.dataUpdatedAt ? Date.now() - query.state.dataUpdatedAt : null,
      })),
    mutations: client
      .getMutationCache()
      .getAll()
      .map((mutation) => ({
        key: compact(mutation.options.mutationKey ?? null),
        status: mutation.state.status,
        scope: mutation.options.scope?.id ?? null,
        variables: compact(mutation.state.variables),
      })),
  }))
}
