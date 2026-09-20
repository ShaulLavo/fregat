import { draftAddressTokenSchema } from '@workspace/client-core/address/references'
import { createRoute } from '@tanstack/react-router'
import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { localWorkspaceRoute, remoteWorkspaceRoute } from '@/state/routes/workspace'

const sessionParams = v.object({ sessionId: v.union([sessionIdSchema, draftAddressTokenSchema]) })
export const localChatRoute = createRoute({
  getParentRoute: () => localWorkspaceRoute,
  path: 'chat',
})
export const remoteChatRoute = createRoute({
  getParentRoute: () => remoteWorkspaceRoute,
  path: 'chat',
})

export function chatChildren<TParent extends typeof localChatRoute | typeof remoteChatRoute>(
  parent: TParent,
) {
  const draft = createRoute({ getParentRoute: () => parent, path: 't/new' })
  const session = createRoute({
    getParentRoute: () => parent,
    path: 't/$sessionId',
    params: { parse: (params) => v.parse(sessionParams, params), stringify: (params) => params },
  })
  return [draft, session] as const
}
