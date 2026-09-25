import type { QueryClient } from '@tanstack/query-core'
import { createBrowserHistory, createRouter, type RouterHistory } from '@tanstack/react-router'
import type { NavigationHistoryTarget } from '@/features/address/utils/history'
import {
  parseRouteSearch,
  stringifyRouteSearch,
  addressPathRewrite,
} from '@/features/address/utils/route-options'
import { rootRoute, startupRoute } from '@/state/routes/root'
import { localWorkspaceRoute, remoteWorkspaceRoute } from '@/state/routes/workspace'
import {
  localWorkbenchRoute,
  remoteWorkbenchRoute,
  workbenchChildren,
} from '@/state/routes/workbench'
import { localChatRoute, remoteChatRoute, chatChildren } from '@/state/routes/chat'

const routeTree = rootRoute.addChildren([
  startupRoute,
  localWorkspaceRoute.addChildren([
    localWorkbenchRoute.addChildren(workbenchChildren(localWorkbenchRoute)),
    localChatRoute.addChildren(chatChildren(localChatRoute)),
  ]),
  remoteWorkspaceRoute.addChildren([
    remoteWorkbenchRoute.addChildren(workbenchChildren(remoteWorkbenchRoute)),
    remoteChatRoute.addChildren(chatChildren(remoteChatRoute)),
  ]),
])

export function createApplicationRouter({
  resources,
  history = createBrowserHistory(),
  basepath = import.meta.env?.BASE_URL ?? '/',
}: {
  resources: QueryClient
  history?: RouterHistory
  basepath?: string
}) {
  return createRouter({
    routeTree,
    context: { resources },
    history,
    basepath,
    parseSearch: parseRouteSearch,
    stringifySearch: stringifyRouteSearch,
    rewrite: addressPathRewrite,
    defaultPreload: false,
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultOnCatch: () => {},
    trailingSlash: 'never',
  })
}

export type ApplicationRouter = ReturnType<typeof createApplicationRouter>

declare module '@tanstack/react-router' {
  interface HistoryState {
    platformNavigationTarget?: NavigationHistoryTarget | null
  }

  interface Register {
    router: ApplicationRouter
  }
}
