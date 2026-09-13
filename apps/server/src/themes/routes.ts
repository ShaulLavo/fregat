import { Elysia } from 'elysia'

import { observeRequestOperation } from '../observability'
import { parsePaletteId, type PaletteLibrary } from './palette-library'

/**
 * GET and POST only: the CORS layer allows exactly GET/POST/OPTIONS, so update
 * and delete are POSTs. Bodies are validated by the library, which raises the
 * typed `themes.*` errors the page branches on.
 */
export function themeRoutes(palettes: PaletteLibrary) {
  return new Elysia({ name: 'theme-routes' }).group('/themes/palettes', (app) =>
    app
      .get('', () =>
        observeRequestOperation({ area: 'themes', operation: 'palettes.list' }, async () => ({
          palettes: await palettes.list(),
        })),
      )
      .post('', ({ body }) =>
        observeRequestOperation(
          { area: 'themes', operation: 'palettes.create' },
          () => palettes.create(body),
          summarizePalette,
        ),
      )
      .get('/:id', ({ params }) =>
        observeRequestOperation(
          { area: 'themes', operation: 'palettes.read', paletteId: params.id },
          () => palettes.read(parsePaletteId(params.id)),
          summarizePalette,
        ),
      )
      .post('/:id', ({ params, body }) =>
        observeRequestOperation(
          { area: 'themes', operation: 'palettes.update', paletteId: params.id },
          () => palettes.update(parsePaletteId(params.id), body),
          summarizePalette,
        ),
      )
      .post('/:id/delete', async ({ params }) => {
        await observeRequestOperation(
          { area: 'themes', operation: 'palettes.delete', paletteId: params.id },
          () => palettes.delete(parsePaletteId(params.id)),
        )

        return { deleted: params.id }
      }),
  )
}

function summarizePalette(document: { id: string; variants: { kind: string } }) {
  return { paletteId: document.id, variants: document.variants.kind }
}
