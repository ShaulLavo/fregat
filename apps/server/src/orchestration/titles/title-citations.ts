const PREFIX = 't3-citation://v1/'
const MAX_HREF = 160_000
const LINK = new RegExp(
  String.raw`\[Assistant quote\]\((${PREFIX}[^\s)]{1,${MAX_HREF - PREFIX.length}})\)`,
  'g',
)

function citationText(href: string): string | null {
  try {
    const url = new URL(href)
    const parts = url.pathname.slice(1).split('/')
    if (
      url.protocol !== 't3-citation:' ||
      url.hostname !== 'v1' ||
      parts.length !== 3 ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null
    if (
      parts.some(
        (part) => !decodeURIComponent(part).trim() || decodeURIComponent(part).trim().length > 512,
      )
    )
      return null
    const required = ['text', 'start', 'end', 'prefix', 'suffix']
    const comment = url.searchParams.get('comment')
    if (
      url.searchParams.size !== required.length + (comment === null ? 0 : 1) ||
      required.some((key) => url.searchParams.getAll(key).length !== 1)
    )
      return null
    const start = url.searchParams.get('start') ?? ''
    const end = url.searchParams.get('end') ?? ''
    if (!/^\d{1,16}$/.test(start) || !/^\d{1,16}$/.test(end)) return null
    if (
      !Number.isSafeInteger(Number(start)) ||
      !Number.isSafeInteger(Number(end)) ||
      Number(end) <= Number(start)
    )
      return null
    const text = url.searchParams.get('text') ?? ''
    if (!text.trim() || text.length > 8_000 || (comment?.length ?? 0) > 8_000) return null
    if (
      (url.searchParams.get('prefix')?.length ?? 0) > 32 ||
      (url.searchParams.get('suffix')?.length ?? 0) > 32
    )
      return null
    return comment === null ? text : `${text}\nComment: ${comment}`
  } catch {
    return null
  }
}

export function assistantCitationsToPlainText(text: string): string {
  return text.replace(LINK, (source: string, href: string) => citationText(href) ?? source)
}
