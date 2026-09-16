import { createRoute } from '@tanstack/react-router'
import { encodePath, encodeSegment } from '@workspace/client-core/address/path-token'
import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { editorReferenceForToken } from '@/features/address/utils/intent'
import { localWorkspaceRoute, remoteWorkspaceRoute } from '@/state/routes/workspace'

const relativePath = v.pipe(
  v.string(),
  v.check((path) => {
    if (!path || path.startsWith('/')) return false
    return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  }, 'Invalid relative file path'),
)
const fileParams = v.object({ _splat: relativePath })
const refParams = v.object({ ref: v.pipe(v.string(), v.nonEmpty()), _splat: relativePath })
const snapshotParams = v.pipe(
  v.object({
    source: v.picklist(['worktree', 'staged', 'branch', 'historical']),
    revision: v.string(),
    _splat: relativePath,
  }),
  v.check(
    (params) =>
      editorReferenceForToken(
        `d/${params.source}/${params.revision}/${encodePath(params._splat)}`,
      ) !== null,
    'Invalid snapshot revision',
  ),
)
const checkpointParams = v.pipe(
  v.object({ sessionId: sessionIdSchema, turns: v.string() }),
  v.check(
    (params) =>
      editorReferenceForToken(`k/${encodeSegment(params.sessionId)}/${params.turns}`) !== null,
    'Invalid checkpoint turns',
  ),
)
const checkpointFileParams = v.pipe(
  v.object({ sessionId: sessionIdSchema, turns: v.string(), _splat: relativePath }),
  v.check(
    (params) =>
      editorReferenceForToken(
        `k/${encodeSegment(params.sessionId)}/${params.turns}/${encodePath(params._splat)}`,
      ) !== null,
    'Invalid checkpoint turns',
  ),
)

export const localWorkbenchRoute = createRoute({
  getParentRoute: () => localWorkspaceRoute,
  path: 'workbench',
})
export const remoteWorkbenchRoute = createRoute({
  getParentRoute: () => remoteWorkspaceRoute,
  path: 'workbench',
})

export function workbenchChildren<
  TParent extends typeof localWorkbenchRoute | typeof remoteWorkbenchRoute,
>(parent: TParent) {
  const settings = createRoute({ getParentRoute: () => parent, path: 'settings' })
  const search = createRoute({ getParentRoute: () => parent, path: 's' })
  const file = createRoute({
    getParentRoute: () => parent,
    path: 'f/$',
    params: { parse: (params) => v.parse(fileParams, params), stringify: (params) => params },
  })
  const compare = createRoute({
    getParentRoute: () => parent,
    path: 'c/$',
    params: { parse: (params) => v.parse(fileParams, params), stringify: (params) => params },
  })
  const history = createRoute({
    getParentRoute: () => parent,
    path: 'h/$',
    params: { parse: (params) => v.parse(fileParams, params), stringify: (params) => params },
  })
  const ref = createRoute({
    getParentRoute: () => parent,
    path: 'r/$ref/$',
    params: { parse: (params) => v.parse(refParams, params), stringify: (params) => params },
  })
  const snapshot = createRoute({
    getParentRoute: () => parent,
    path: 'd/$source/$revision/$',
    params: { parse: (params) => v.parse(snapshotParams, params), stringify: (params) => params },
  })
  const checkpoint = createRoute({
    getParentRoute: () => parent,
    path: 'k/$sessionId/$turns',
    params: { parse: (params) => v.parse(checkpointParams, params), stringify: (params) => params },
  })
  const checkpointFile = createRoute({
    getParentRoute: () => parent,
    path: 'k/$sessionId/$turns/$',
    params: {
      parse: (params) => {
        if (!params._splat) return false
        return v.parse(checkpointFileParams, params)
      },
      stringify: (params) => params,
    },
  })
  return [
    settings,
    search,
    file,
    compare,
    history,
    ref,
    snapshot,
    checkpoint,
    checkpointFile,
  ] as const
}
