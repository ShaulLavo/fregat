import type { Element } from 'hast'
import { use, type ComponentProps } from 'react'

import { MarkdownRenderContext } from '../providers/render-context'

type MarkdownPreProps = ComponentProps<'pre'> & { node?: Element | undefined }

const LANGUAGE_CLASS = /^language-(\S+)/u

/**
 * Every fenced block reaches the consumer's renderer through here, with the
 * fence text, language, metastring and streaming state read off the hast node
 * rather than reconstructed from rendered children.
 */
export function MarkdownPre({ children, node, ...props }: MarkdownPreProps) {
  const { codeBlock: CodeBlock } = use(MarkdownRenderContext)
  const code = node ? fencedCode(node) : null
  if (!CodeBlock || !code) return <pre {...props}>{children}</pre>

  return (
    <CodeBlock
      code={code.text}
      incomplete={code.incomplete}
      language={code.language}
      meta={code.meta}
    />
  )
}

function fencedCode(pre: Element) {
  const code = pre.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'code',
  )
  if (!code) return null

  const meta = code.properties.dataMeta

  return {
    incomplete: code.properties.dataIncomplete === 'true',
    language: languageOf(code),
    meta: typeof meta === 'string' ? meta : undefined,
    // The hast handler appends one newline to a fence's value; the renderer wants the value.
    text: textOf(code).replace(/\n$/u, ''),
  }
}

function languageOf(code: Element) {
  const classNames = code.properties.className
  const list = Array.isArray(classNames) ? classNames : [classNames]
  for (const className of list) {
    const match = typeof className === 'string' ? LANGUAGE_CLASS.exec(className) : null
    if (match?.[1]) return match[1]
  }

  return ''
}

function textOf(node: Element): string {
  let text = ''
  for (const child of node.children) {
    if (child.type === 'text') text += child.value
    if (child.type === 'element') text += textOf(child)
  }

  return text
}
