import path from 'node:path'
import { Elysia, t } from 'elysia'
import { observeRequestOperation } from '../../observability'
import { wallpaperColors } from './colors'
import { wallpaperErrors } from './structured-errors'
import { OMARCHY_THEMES_DIRECTORY, parseAssetId, type WallpaperLibrary } from './library'

export function wallpaperLibraryRoutes(library: WallpaperLibrary) {
  return new Elysia({ name: 'wallpaper-library' }).group('/themes/wallpapers', (app) =>
    app
      .get('', () =>
        observeRequestOperation(
          { area: 'wallpaper', operation: 'library.list', sourceKind: 'library' },
          async () => {
            const assets = await library.list()
            return { assets, catalog: library.catalog(assets) }
          },
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
      .post('/catalog/:id', ({ params }) =>
        observeRequestOperation(
          {
            area: 'wallpaper',
            operation: 'library.catalog-install',
            sourceKind: 'library',
            assetId: params.id,
          },
          () => library.installCatalog(parseAssetId(params.id)),
          (asset) => ({ assetId: asset.id }),
        ),
      )
      .get('/:id/asset', ({ params }) => media(library, params.id, 'asset'))
      .get('/:id/display', ({ params }) => media(library, params.id, 'display'))
      .get('/:id/thumbnail', ({ params }) => media(library, params.id, 'thumbnail'))
      .get('/:id/colors', ({ params }) =>
        observeRequestOperation(
          {
            area: 'wallpaper',
            operation: 'library.colors',
            sourceKind: 'library',
            assetId: params.id,
          },
          () => wallpaperColors(library, parseAssetId(params.id)),
          (colors) => ({ clusterCount: colors.clusters.length }),
        ),
      )
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
      const file = Bun.file(
        kind === 'asset'
          ? path.join(await library.assetDirectory(id), `${id}.${asset.extension}`)
          : await library.rendition(id, kind),
      )
      if (!(await file.exists()))
        throw wallpaperErrors.NOT_FOUND({ internal: { at: 'serve', asset: id, kind } })
      return new Response(file, {
        headers: {
          'content-type': kind === 'asset' ? asset.contentType : 'image/webp',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    },
  )
}
