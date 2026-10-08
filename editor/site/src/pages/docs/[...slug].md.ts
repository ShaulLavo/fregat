import type { APIRoute } from 'astro'
import { MANUAL_SOURCES } from '../../manual/content'

export function getStaticPaths() {
  return [...MANUAL_SOURCES.keys()].map((file) => ({
    params: { slug: file.replace(/\.md$/, '') },
    props: { text: MANUAL_SOURCES.get(file)! },
  }))
}

/** The Markdown source the editor opens, served beside its page. */
export const GET: APIRoute = ({ props }) =>
  new Response(props.text as string, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
