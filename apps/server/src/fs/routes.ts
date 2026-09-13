import { Elysia } from 'elysia'
import {
  copyBodySchema,
  createFileBodySchema,
  createFolderBodySchema,
  deleteBodySchema,
  eventsQuerySchema,
  openWorkspaceRootBodySchema,
  pathQuerySchema,
  readQuerySchema,
  recordRecentBodySchema,
  recentsQuerySchema,
  registerWorkspaceAddressBodySchema,
  renameBodySchema,
  searchQuerySchema,
  treeQuerySchema,
  writeBodySchema,
  workspaceEditPrepareBodySchema,
  workspaceEditRecoverBodySchema,
  workspaceEditRecoveryQuerySchema,
  workspaceEditReleaseBodySchema,
  workspaceEditStatusQuerySchema,
  workspaceEditTransitionBodySchema,
  workspaceAddressParamsSchema,
} from './contracts'
import { errorPayload, FsError, isFsError } from './errors'
import type { SearchStreamEvent } from './search'
import type { FileSystemService } from './service'
import { parseWatchInputs } from './watch'
import { sseResponse, toErrorYieldingSse, toSse } from '../sse'

export function fsRoutes(fs: FileSystemService) {
  return new Elysia({ name: 'fs-routes' }).group('/fs', (app) =>
    app
      .get('/stat', ({ query }) => fs.stat(query.path), {
        query: pathQuerySchema,
      })
      .get('/tree', ({ query }) => fs.tree(query.path, query.depth, query.entryType), {
        query: treeQuerySchema,
      })
      .get('/read', ({ query }) => fs.read(query.path, query.acceptTextOnly), {
        query: readQuerySchema,
      })
      .get('/blob', async ({ query }) => fileResponse(await fs.blob(query.path)), {
        query: pathQuerySchema,
      })
      .get(
        '/search/events',
        ({ query, request }) =>
          sseResponse(
            toErrorYieldingSse(fs.searchEvents(query, request.signal), {
              data: searchEventData,
              errorData: searchErrorData,
              event: (event) => event.type,
            }),
            request.signal,
          ),
        {
          query: searchQuerySchema,
        },
      )
      .get(
        '/events',
        ({ query, request }) =>
          sseResponse(
            toSse(fs.events(parseWatchInputs(query.path, query.paths), request.signal), {
              event: (event) => event.type,
            }),
            request.signal,
          ),
        {
          query: eventsQuerySchema,
        },
      )
      .get('/recents', ({ query }) => fs.recents(query), {
        query: recentsQuerySchema,
      })
      .post('/recents', ({ body }) => fs.recordRecent(body.path), {
        body: recordRecentBodySchema,
      })
      .post('/workspace-root', ({ body }) => fs.openWorkspaceRoot(body), {
        body: openWorkspaceRootBodySchema,
      })
      .post('/workspace-address', ({ body }) => fs.registerWorkspaceAddress(body.path), {
        body: registerWorkspaceAddressBodySchema,
      })
      .get('/workspace-address/:id', ({ params }) => fs.resolveWorkspaceAddress(params.id), {
        params: workspaceAddressParamsSchema,
      })
      .post('/write', ({ body }) => fs.write(body), {
        body: writeBodySchema,
      })
      .post('/create-file', ({ body }) => fs.createFile(body), {
        body: createFileBodySchema,
      })
      .post('/create-folder', ({ body }) => fs.createFolder(body), {
        body: createFolderBodySchema,
      })
      .post('/rename', ({ body }) => fs.rename(body), {
        body: renameBodySchema,
      })
      .post('/copy', ({ body }) => fs.copy(body), {
        body: copyBodySchema,
      })
      .post('/delete', ({ body }) => fs.delete(body), {
        body: deleteBodySchema,
      })
      .group('/workspace-edit', (workspaceEdit) =>
        workspaceEdit
          .post('/prepare', ({ body }) => fs.workspaceEditPrepare(body), {
            body: workspaceEditPrepareBodySchema,
          })
          .post('/commit', ({ body }) => fs.workspaceEditCommit(body), {
            body: workspaceEditTransitionBodySchema,
          })
          .post('/finalize', ({ body }) => fs.workspaceEditFinalize(body), {
            body: workspaceEditTransitionBodySchema,
          })
          .get('/status', ({ query }) => fs.workspaceEditStatus(query.operationId), {
            query: workspaceEditStatusQuerySchema,
          })
          .post('/abort', ({ body }) => fs.workspaceEditAbort(body), {
            body: workspaceEditTransitionBodySchema,
          })
          .post('/rollback', ({ body }) => fs.workspaceEditRollback(body), {
            body: workspaceEditTransitionBodySchema,
          })
          .post('/undo', ({ body }) => fs.workspaceEditUndo(body), {
            body: workspaceEditTransitionBodySchema,
          })
          .post('/redo', ({ body }) => fs.workspaceEditRedo(body), {
            body: workspaceEditTransitionBodySchema,
          })
          .post('/recover', ({ body }) => fs.workspaceEditRecover(body), {
            body: workspaceEditRecoverBodySchema,
          })
          .post('/release', ({ body }) => fs.workspaceEditRelease(body), {
            body: workspaceEditReleaseBodySchema,
          })
          .get('/recovery', ({ query }) => fs.workspaceEditRecovery(query.workspace), {
            query: workspaceEditRecoveryQuerySchema,
          }),
      ),
  )
}

type BlobFile = Awaited<ReturnType<FileSystemService['blob']>>

async function fileResponse(result: BlobFile) {
  const file = Bun.file(result.absolutePath)
  const headers = new Headers({
    'content-length': String(result.size),
    'x-fs-path': result.path,
    'x-fs-mtime-ms': String(result.mtimeMs),
    'x-fs-version': result.version,
  })

  headers.set('content-type', file.type || 'application/octet-stream')
  return new Response(file, { headers })
}

function searchEventData(event: SearchStreamEvent) {
  if (event.type === 'match') return { match: event.match }
  if (event.type === 'warning') {
    return { code: event.code, detail: event.detail, message: event.message }
  }

  return {
    query: event.query,
    path: event.path,
    count: event.count,
    fileCount: event.fileCount,
    measurement: event.measurement,
    truncated: event.truncated,
  }
}

function searchErrorData(error: unknown) {
  const fsError = isFsError(error) ? error : new FsError('OPERATION_FAILED', undefined, error)

  return errorPayload(fsError)
}
