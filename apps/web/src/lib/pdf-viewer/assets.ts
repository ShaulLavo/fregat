import { pdfQueryKeys } from '@/lib/pdf-viewer/query-keys'
import { queryOptions } from '@tanstack/react-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { pdfError } from '@/lib/pdf-viewer/structured-errors'

const assets = {
  ...import.meta.glob<string>(
    '../../../node_modules/pdfjs-dist/{LICENSE,cmaps/LICENSE,standard_fonts/LICENSE_FOXIT,wasm/LICENSE*}',
    { eager: true, query: '?url&no-inline', import: 'default' },
  ),
  ...import.meta.glob<string>('../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
  ...import.meta.glob<string>('../../../node_modules/pdfjs-dist/standard_fonts/*.pfb', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
  ...import.meta.glob<string>(
    '../../../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg,qcms_bg}.wasm',
    { eager: true, query: '?url', import: 'default' },
  ),
}
const urls = new Map(
  Object.entries(assets).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
)

/** The worker requests installed package assets only; hashed bundle URLs survive deployment bases. */
export class PdfBinaryDataFactory {
  fetch({ filename }: { filename: string }) {
    const url = urls.get(filename)
    if (!url) throw pdfError('ENGINE_UNAVAILABLE', filename.length, 'asset-name')
    return resourceQueryClient.query(
      queryOptions({
        queryKey: pdfQueryKeys.asset(url),
        staleTime: Infinity,
        queryFn: async ({ signal }) => {
          const response = await fetch(url, { signal })
          if (!response.ok) throw pdfError('ENGINE_UNAVAILABLE', response.status, 'asset-read')
          return new Uint8Array(await response.arrayBuffer())
        },
      }),
    )
  }
}
