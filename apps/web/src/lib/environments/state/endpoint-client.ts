import type { Client } from '@/lib/client'
import { createClientError } from '@workspace/client-core/errors'

export function createEndpointClient({
  origin,
  resolveEndpoint,
  createClient,
}: {
  readonly origin: string
  readonly resolveEndpoint: (origin: string) => string
  readonly createClient: (endpoint: string) => Client
}): Client {
  const initial = createClient(origin)
  const clients = new Map<string, Client>([[origin, initial]])
  function current() {
    const endpoint = resolveEndpoint(origin)
    const existing = clients.get(endpoint)
    if (existing) return existing
    const client = createClient(endpoint)
    clients.set(endpoint, client)
    return client
  }
  function invoke(path: readonly PropertyKey[], args: readonly unknown[]) {
    let target: unknown = current()
    let receiver: unknown = target
    for (const key of path) {
      receiver = target
      target = Reflect.get(Object(target), key)
    }
    if (typeof target !== 'function')
      throw createClientError({
        code: 'INVALID_ENDPOINT_ROUTE',
        status: 500,
        message: 'The app called a server action that does not exist.',
        why: 'The request named a server route with no action behind it.',
        fix: 'Reload the app and try again.',
      })
    return Reflect.apply(target, receiver, args)
  }
  function route(path: readonly PropertyKey[]): unknown {
    return new Proxy(() => {}, {
      get: (_target, key) => route(path.concat([key])),
      // Resolving at invocation keeps every in-flight request on its original endpoint.
      apply: (_target, _receiver, args) => invoke(path, args),
    })
  }
  return new Proxy(initial, { get: (_target, key) => route([key]) })
}
