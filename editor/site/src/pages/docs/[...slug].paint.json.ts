import { readerDocument } from '../../manual/captured'
import { MANUAL_SOURCES, renderPage } from '../../manual/content'
export function getStaticPaths() {
  return [...MANUAL_SOURCES.keys()].map((file) => ({
    params: { slug: file.replace(/\.md$/, '') },
    props: { file },
  }))
}
export function GET({ props }: { readonly props: { readonly file: string } }) {
  return new Response(JSON.stringify(readerDocument(renderPage(props.file))), {
    headers: { 'Content-Type': 'application/json' },
  })
}
