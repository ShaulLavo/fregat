import { omarchyBundleArchive } from './omarchy-bundle'
import { Elysia } from 'elysia'
import { observeRequestOperation } from '../observability'
import type { BundleLibrary } from './bundle-library'

export function bundleRoutes(bundles: BundleLibrary) {
  return new Elysia({ name: 'theme-bundles' }).group('/themes/bundles', (app) =>
    app
      .get('', () =>
        observeRequestOperation({ area: 'themes', operation: 'bundles.list' }, () =>
          bundles.list(),
        ),
      )
      .post('', ({ body }) =>
        observeRequestOperation({ area: 'themes', operation: 'bundles.create' }, () =>
          bundles.create(body),
        ),
      )
      .post('/import', ({ body }) =>
        observeRequestOperation({ area: 'themes', operation: 'bundles.import' }, () =>
          bundles.importArchive(body),
        ),
      )
      .post('/omarchy', ({ body }) =>
        observeRequestOperation({ area: 'themes', operation: 'bundles.omarchy' }, async () => {
          const { archive, report } = await omarchyBundleArchive(body)
          const theme = await bundles.importArchive(archive)
          return { theme, report }
        }),
      )
      .post('/:id/delete', ({ params }) =>
        observeRequestOperation(
          { area: 'themes', operation: 'bundles.delete', themeId: params.id },
          () => bundles.remove(params.id),
        ),
      )
      .get('/:id/export', ({ params }) =>
        observeRequestOperation(
          { area: 'themes', operation: 'bundles.export', themeId: params.id },
          () => bundles.exportArchive(params.id),
        ),
      ),
  )
}
