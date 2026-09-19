import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Elysia, t } from 'elysia'
import { observeRequestOperation } from '../../observability'
import { wallpaperErrors } from './structured-errors'
import {
  displayName,
  OMARCHY_THEMES_DIRECTORY,
  parseAssetId,
  type WallpaperLibrary,
} from './library'

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
      .get('/:id/asset', ({ params }) => media(library, params.id, 'asset'))
      .get('/:id/display', ({ params }) => media(library, params.id, 'display'))
      .get('/:id/thumbnail', ({ params }) => media(library, params.id, 'thumbnail'))
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

type MediaKind = 'asset' | 'display' | 'thumbnail'

function media(library: WallpaperLibrary, input: string, kind: MediaKind) {
  const id = parseAssetId(input)
  return observeRequestOperation(
    { area: 'wallpaper', operation: `library.${kind}`, sourceKind: 'library', assetId: id },
    async () => {
      const asset = await library.read(id)
      const names = {
        asset: `${id}.${asset.extension}`,
        display: displayName(id),
        thumbnail: asset.thumbnail,
      }
      const file = Bun.file(path.join(await library.assetDirectory(id), names[kind]))
      if (!(await file.exists())) throw wallpaperErrors.NOT_FOUND()
      return new Response(file, {
        headers: {
          'content-type': kind === 'asset' ? asset.contentType : 'image/webp',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    },
  )
}
