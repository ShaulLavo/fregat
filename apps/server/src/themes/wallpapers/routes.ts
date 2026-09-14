import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Elysia, t } from 'elysia'
import { observeRequestOperation } from '../../observability'
import { OMARCHY_THEMES_DIRECTORY, parseAssetId, type WallpaperLibrary } from './library'

export function wallpaperLibraryRoutes(library: WallpaperLibrary) {
  return new Elysia({ name: 'wallpaper-library' }).group('/themes/wallpapers', (app) =>
    app
      .get('', () =>
        observeRequestOperation(
          { area: 'wallpaper', operation: 'library.list', sourceKind: 'library' },
          async () => ({
            assets: await library.list(),
            omarchyAvailable: await stat(OMARCHY_THEMES_DIRECTORY).then(
              (entry) => entry.isDirectory(),
              () => false,
            ),
          }),
        ),
      )
      .post(
        '',
        ({ body }) =>
          observeRequestOperation(
            { area: 'wallpaper', operation: 'library.upload', sourceKind: 'library' },
            () => library.upload(body.file),
            (asset) => ({ assetId: asset.id }),
          ),
        { body: t.Object({ file: t.File() }) },
      )
      .post(
        '/import-directory',
        ({ body }) =>
          observeRequestOperation(
            { area: 'wallpaper', operation: 'library.import', sourceKind: 'library' },
            () => library.importDirectory(body.path ?? OMARCHY_THEMES_DIRECTORY),
          ),
        { body: t.Object({ path: t.Optional(t.String()) }) },
      )
      .get('/:id/asset', ({ params }) => media(library, params.id, false))
      .get('/:id/thumbnail', ({ params }) => media(library, params.id, true))
      .post('/:id/delete', ({ params }) =>
        observeRequestOperation(
          {
            area: 'wallpaper',
            operation: 'library.delete',
            sourceKind: 'library',
            assetId: params.id,
          },
          () => library.delete(parseAssetId(params.id)),
        ),
      ),
  )
}

function media(library: WallpaperLibrary, input: string, thumbnail: boolean) {
  const id = parseAssetId(input)
  return observeRequestOperation(
    {
      area: 'wallpaper',
      operation: thumbnail ? 'library.thumbnail' : 'library.asset',
      sourceKind: 'library',
      assetId: id,
    },
    async () => {
      const asset = await library.read(id)
      const file = path.join(
        library.directory,
        thumbnail ? `${id}.thumb.webp` : `${id}.${asset.extension}`,
      )
      return new Response(Bun.file(file), {
        headers: {
          'content-type': thumbnail ? 'image/webp' : asset.contentType,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    },
  )
}
