import { createRootRoute, createRoute, stripSearchParams } from '@tanstack/react-router'
import { routeSearchSchema } from '@/features/address/utils/route-options'

export const rootRoute = createRootRoute({
  validateSearch: routeSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({ side: 'files', bottom: 'terminal', tool: 'git', rail: 'active' }),
    ],
  },
})

export const startupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' })
