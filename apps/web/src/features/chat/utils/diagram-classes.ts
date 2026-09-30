const CLASS_PREFIX = 'mermaid_user_'

export function isolateDiagramClasses(chart: string): string {
  const editable = maskQuotedText(chart)
  const replacements: { start: number; end: number; text: string }[] = []
  const pattern =
    /\bclassDef\s+([\w,-]+)|\b(?:class|cssClass)\s+[^\n;{}]+?\s+([\w,-]+)(?=\s*(?:[;\n]|$))|:::([\w,-]+)/g
  for (const match of editable.matchAll(pattern)) {
    const group = match[1] ?? match[2] ?? match[3]
    if (!group) continue
    const offset = match[0].lastIndexOf(group)
    const text = group
      .split(',')
      .map((name) => (name === 'default' ? name : `${CLASS_PREFIX}${name}`))
      .join(',')
    replacements.push({
      start: match.index + offset,
      end: match.index + offset + group.length,
      text,
    })
  }
  let result = chart
  for (const replacement of replacements.reverse())
    result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`
  return result
}

function maskQuotedText(chart: string) {
  return chart.replace(
    /\[[^\]\n]*\]|\([^)\n]*\)|\{[^}\n]*\}|%%[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g,
    (text) => text.replace(/[^\n]/g, ' '),
  )
}
