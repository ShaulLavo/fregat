import { createClientInvariantError } from '@/lib/structured-errors'
import type { Observation } from '../../../../packages/markdown/test/qualification'

/** Excludes declared copy chrome, while preserving all message whitespace and content. */
export function observeMarkdownDom(host: Element): Observation {
  const copy = host.cloneNode(true)
  if (!(copy instanceof Element))
    throw createClientInvariantError('Markdown observation needs an element')
  for (const chrome of copy.querySelectorAll('[data-markdown-copy=""]')) chrome.remove()
  for (const favicon of copy.querySelectorAll('[data-chat-link-favicon]')) favicon.remove()
  return {
    text: renderedText(copy),
    elements: Array.from(copy.querySelectorAll('*'), (element) => ({
      tag: element.tagName.toLowerCase(),
      text: renderedText(element),
      attributes: logicalAttributes(element),
      parents: ancestorTags(element, copy),
    })),
  }
}

function logicalAttributes(element: Element): Record<string, string> {
  const attributes = Object.fromEntries(
    Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]),
  )
  if (
    (element.tagName === 'TH' || element.tagName === 'TD') &&
    element instanceof HTMLElement &&
    element.style.textAlign
  )
    attributes.align = element.style.textAlign
  return attributes
}

/** Preserves content, classes and whitespace; normalizes only React ids and declared host chrome. */
export function observeMarkdownSemantics(host: HTMLElement): Observation {
  const copy = host.cloneNode(true)
  if (!(copy instanceof HTMLElement))
    throw createClientInvariantError('Markdown semantics need an element')
  const observation = observeMarkdownDom(copy)
  const generatedIds = new Map<string, string>()
  return {
    text: observation.text,
    elements: observation.elements.map((element) => ({
      ...element,
      attributes: normalizeReactReferences(element.attributes, generatedIds),
    })),
  }
}

function normalizeReactReferences(
  attributes: Readonly<Record<string, string>>,
  generatedIds: Map<string, string>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name,
      normalizeReference(name, value, generatedIds),
    ]),
  )
}

function normalizeReference(
  name: string,
  value: string,
  generatedIds: Map<string, string>,
): string {
  if (name === 'id' && value.startsWith('user-content-')) return value
  if (!referenceAttribute(name)) return value
  return normalizeGeneratedIds(value, generatedIds)
}

function referenceAttribute(name: string): boolean {
  return (
    name === 'id' ||
    name === 'for' ||
    name === 'aria-describedby' ||
    name === 'aria-labelledby' ||
    name === 'aria-controls' ||
    name.startsWith('data-base-ui-')
  )
}

function normalizeGeneratedIds(value: string, generatedIds: Map<string, string>): string {
  return value
    .split(/(\s+)/u)
    .map((id) => normalizeGeneratedId(id, generatedIds))
    .join('')
}

function normalizeGeneratedId(id: string, generatedIds: Map<string, string>): string {
  const prefix = id.startsWith('base-ui-') ? 'base-ui-' : ''
  const reactId = id.slice(prefix.length)
  if (!/^(?:_r_[\da-z]+_|:r[\da-z]+:|«r[\da-z]+»)$/u.test(reactId)) return id
  const existing = generatedIds.get(reactId)
  if (existing) return prefix + existing
  const next = `react-generated-${generatedIds.size}`
  generatedIds.set(reactId, next)
  return prefix + next
}

function renderedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof HTMLBRElement) return '\n'
  return Array.from(node.childNodes, renderedText).join('')
}

function ancestorTags(element: Element, root: Element): string[] {
  const parents: string[] = []
  let parent = element.parentElement
  while (parent && parent !== root) {
    parents.push(parent.tagName.toLowerCase())
    parent = parent.parentElement
  }
  return parents.reverse()
}
