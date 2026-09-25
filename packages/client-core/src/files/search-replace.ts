export function expandRegexReplacement(replacement: string, match: RegExpExecArray) {
  const tokens = match.groups
    ? /\\[nt\\]|\$(\$|&|`|'|\d{1,2}|<[^>]*>)/gu
    : /\\[nt\\]|\$(\$|&|`|'|\d{1,2})/gu
  return replacement.replace(tokens, (token: string, name: string | undefined) => {
    if (token === '\\n') return '\n'
    if (token === '\\t') return '\t'
    if (token === '\\\\') return '\\'
    if (name === undefined) return token
    return replacementCapture(token, name, match)
  })
}

function replacementCapture(token: string, name: string, match: RegExpExecArray) {
  if (name === '$') return '$'
  if (name === '&' || name === '0') return match[0]
  if (name === '`') return match.input.slice(0, match.index)
  if (name === "'") return match.input.slice(match.index + match[0].length)
  if (name.startsWith('<')) return match.groups?.[name.slice(1, -1)] ?? ''
  const index = Number(name)
  if (index > 0 && index < match.length) return match[index] ?? ''
  const firstDigit = Number(name[0])
  if (name.length === 2 && firstDigit > 0 && firstDigit < match.length)
    return `${match[firstDigit] ?? ''}${name[1]}`
  return token
}
