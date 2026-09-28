import type { TextReadSnapshot } from '@singapore-editor/core/document'
import { decodeString } from 'micromark-util-decode-string'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
import { Kind } from 'tree-sitter-md'

export type MarkdownSpan = { readonly start: number; readonly end: number }

export function markdownLinkDestination(
  source: TextReadSnapshot,
  link: MarkdownSpan,
  label: MarkdownSpan,
  records: Uint32Array,
): string | null {
  const suffix = source.readRange(label.end, link.end)
  if (suffix.startsWith('](')) return safeDestination(readDestination(suffix, 2))
  const raw = source.readRange(link.start, link.end)
  if (raw.startsWith('<') || link.start === label.start) {
    const target = source.readRange(label.start, label.end)
    if (target.startsWith('www.')) return safeDestination(`https://${target}`)
    return safeDestination(
      target.includes('@') && !target.includes(':') ? `mailto:${target}` : target,
    )
  }
  const reference = suffix.startsWith('][') ? suffix.slice(2, -1) : ''
  const identifier = normalizeIdentifier(reference || source.readRange(label.start, label.end))
  for (let index = 0; index < records.length; index += 4) {
    if (records[index + 2] !== Kind.Definition) continue
    const definition = source.readRange(records[index]!, records[index + 1]!).trimStart()
    const end = closingBracket(definition)
    if (end < 0 || normalizeIdentifier(definition.slice(1, end)) !== identifier) continue
    return safeDestination(readDestination(definition, end + 2))
  }
  return null
}

function closingBracket(source: string): number {
  for (let index = 1; index < source.length; index++) {
    if (source[index] === '\\') index++
    else if (source[index] === ']' && source[index + 1] === ':') return index
  }
  return -1
}

function readDestination(source: string, from: number): string {
  while (/\s/.test(source[from] ?? '') && from < source.length) from++
  const angle = source[from] === '<'
  const start = from + (angle ? 1 : 0)
  return decodeString(source.slice(start, destinationEnd(source, start, angle)))
}

export function destinationEnd(text: string, start: number, angle: boolean): number {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (character === '\\') {
      index++
      continue
    }
    if (angle && character === '>') return index
    if (angle) continue
    if ((character === ')' && depth === 0) || /\s/.test(character!)) return index
    if (character === '(') depth++
    if (character === ')') depth--
  }
  return text.length
}

function safeDestination(href: string): string | null {
  href = href.trim()
  const scheme = href.match(/^([a-z][a-z\d+.-]*):/iu)?.[1]?.toLowerCase()
  if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) return null
  if (
    [...href].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return null
  return href
}
