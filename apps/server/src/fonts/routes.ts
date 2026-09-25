import { Elysia } from 'elysia'

import { errorPayload, FsError } from '../fs/errors'
import { FontCatalogService } from './catalog'
import {
  fontPreviewQuerySchema,
  fontsourceFileParamsSchema,
  fontsourceStylesheetParamsSchema,
  localFileParamsSchema,
  localStylesheetParamsSchema,
  nerdFontParamsSchema,
} from './contracts'

const IMMUTABLE = 'public, max-age=31536000, immutable'

export function fontRoutes(fonts = new FontCatalogService()) {
  return new Elysia({ name: 'font-routes' }).group('/fonts', (app) =>
    app
      .get('', () => fonts.catalog())
      .get(
        '/preview',
        async ({ query, set }) => {
          const subset = await fonts.preview(query.ref, query.text)
          if (!subset) return fontNotFound(set)

          return fontResponse(subset, 'font/woff2', 'public, max-age=86400')
        },
        { query: fontPreviewQuerySchema },
      )
      .get(
        '/nerd/:name',
        async ({ params, set }) => {
          const font = await fonts.nerd.font(params.name)
          if (!font) return fontNotFound(set)

          return fontResponse(font, 'font/ttf', IMMUTABLE)
        },
        { params: nerdFontParamsSchema },
      )
      .get(
        '/fontsource/:id',
        async ({ params, set }) => {
          const css = await fonts.fontsource.stylesheet(params.id.slice(0, -'.css'.length))
          if (css === null) return fontNotFound(set)

          // Short-lived: the faces are immutable, but the served weights may change.
          return new Response(css, {
            headers: { 'cache-control': 'public, max-age=86400', 'content-type': 'text/css' },
          })
        },
        { params: fontsourceStylesheetParamsSchema },
      )
      .get(
        '/fontsource/:id/:file',
        async ({ params, set }) => {
          const file = await fonts.fontsource.file(params.id, params.file)
          if (!file) return fontNotFound(set)

          return fontResponse(file, 'font/woff2', IMMUTABLE)
        },
        { params: fontsourceFileParamsSchema },
      )
      .get(
        '/local/:id',
        async ({ params, set }) => {
          const css = await fonts.installed.stylesheet(params.id.slice(0, -'.css'.length))
          if (css === null) return fontNotFound(set)

          // Never cached: installing or removing a font changes it.
          return new Response(css, {
            headers: { 'cache-control': 'no-cache', 'content-type': 'text/css' },
          })
        },
        { params: localStylesheetParamsSchema },
      )
      .get(
        '/local/:id/:face',
        async ({ params, request, set }) => {
          const file = await fonts.installed.file(params.id, Number(params.face))
          if (!file) return fontNotFound(set)
          if (request.headers.get('if-none-match') === file.etag) {
            return new Response(null, { status: 304, headers: { etag: file.etag } })
          }

          const response = fontResponse(file.data, file.contentType, 'no-cache')
          response.headers.set('etag', file.etag)
          return response
        },
        { params: localFileParamsSchema },
      ),
  )
}

function fontResponse(data: Buffer, contentType: string, cacheControl: string) {
  return new Response(new Uint8Array(data), {
    headers: {
      'cache-control': cacheControl,
      'content-length': String(data.byteLength),
      'content-type': contentType,
    },
  })
}

function fontNotFound(set: { status?: number | string }) {
  set.status = 404
  return errorPayload(new FsError('NOT_FOUND', 'font not found'))
}
