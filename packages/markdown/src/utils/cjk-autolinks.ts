import type { Link, Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

const CJK_PUNCTUATION = new Set([
  '。',
  '．',
  '，',
  '、',
  '？',
  '！',
  '：',
  '；',
  '（',
  '）',
  '【',
  '】',
  '「',
  '」',
  '『',
  '』',
  '〈',
  '〉',
  '《',
  '》',
])

const AUTOLINK = /^(https?:\/\/|mailto:|www\.)/i

function isLiteralAutolink(link: Link): boolean {
  if (link.children.length !== 1) return false

  const [child] = link.children

  return child?.type === 'text' && child.value === link.url
}

function cjkPunctuationOffset(url: string): number | null {
  let offset = 0
  for (const character of url) {
    if (CJK_PUNCTUATION.has(character)) return offset
    offset += character.length
  }

  return null
}

/**
 * GFM's literal autolinks run until whitespace, so `https://x.dev。` swallows
 * the full-width period. Runs after GFM and splits the punctuation back out.
 */
export function remarkCjkAutolinkBoundaries() {
  return (tree: Root) => {
    visit(tree, 'link', (link, index, parent) => {
      if (!parent || typeof index !== 'number') return
      if (!isLiteralAutolink(link) || !AUTOLINK.test(link.url)) return

      const offset = cjkPunctuationOffset(link.url)
      if (offset === null || offset === 0) return

      const url = link.url.slice(0, offset)
      const trailing: Text = { type: 'text', value: link.url.slice(offset) }
      const trimmed: Link = { ...link, url, children: [{ type: 'text', value: url }] }
      parent.children.splice(index, 1, trimmed, trailing)

      return index + 1
    })
  }
}
