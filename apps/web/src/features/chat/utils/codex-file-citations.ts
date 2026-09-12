const DIRECTIVE = /:codex-file-citation\{([^{}\r\n]*)\}/gu
const ATTRIBUTE = /([\w-]+)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')/gu
const FENCE = /^ {0,3}(`{3,}|~{3,})/u

export function codexFileCitationsMarkdown(markdown: string) {
  if (!markdown.includes(':codex-file-citation{')) return markdown
  const state: CitationCodeState = { fence: null, codeTicks: 0 }
  return markdown
    .split(/(\r?\n)/u)
    .map((line) => renderCitationLine(line, state))
    .join('')
}

type CitationCodeState = { fence: string | null; codeTicks: number }

function renderCitationLine(line: string, state: CitationCodeState) {
  const marker = line.match(FENCE)?.[1]
  if (marker) {
    if (!state.fence) state.fence = marker
    else if (marker[0] === state.fence[0] && marker.length >= state.fence.length) state.fence = null
    return line
  }
  if (state.fence || /^ {4}|^\t/u.test(line)) return line
  return line
    .split(/(`+)/u)
    .map((part, index) => renderCitationPart(part, index, state))
    .join('')
}

function renderCitationPart(part: string, index: number, state: CitationCodeState) {
  if (index % 2 === 0) return state.codeTicks > 0 ? part : part.replace(DIRECTIVE, fileCitation)
  if (state.codeTicks === 0) state.codeTicks = part.length
  else if (state.codeTicks === part.length) state.codeTicks = 0
  return part
}

function fileCitation(original: string, attributes: string) {
  const values = new Map<string, string>()
  let end = 0
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    if (attributes.slice(end, match.index).trim() || !match[1] || values.has(match[1]))
      return original
    values.set(match[1], match[2] ?? match[3] ?? '')
    end = match.index + match[0].length
  }
  if (attributes.slice(end).trim()) return original
  const path = values.get('path')
  if (!path || path.includes('\0') || /[\r\n]/u.test(path) || /^[a-z][a-z\d+.-]*:/iu.test(path))
    return original
  const label =
    path
      .split('/')
      .at(-1)
      ?.replaceAll('\\', '\\\\')
      .replaceAll('[', '\\[')
      .replaceAll(']', '\\]') || path
  const destination = path.split('/').map(encodeURIComponent).join('/')
  return `[${label}](${destination})`
}
