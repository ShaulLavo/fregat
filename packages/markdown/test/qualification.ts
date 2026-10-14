import type { Element, Nodes, Root } from 'hast'
import rehypeRaw from 'rehype-raw'
import type { PluggableList } from 'unified'

import { blockToHast, createHastProcessor, type HastExtensions } from '../src/utils/hast'
import { createMarkdownSession } from '../src/utils/session'
import type { Expectation } from './fixtures/cases'

type ElementObservation = {
  readonly tag: string
  readonly text: string
  readonly attributes: Readonly<Record<string, string>>
  readonly parents?: readonly string[]
}
export type Observation = {
  readonly text: string
  readonly elements: readonly ElementObservation[]
}
export type ReplayOptions = {
  readonly extensions?: HastExtensions
  readonly remarkPlugins?: PluggableList
}

const LOADED_HTML: HastExtensions = { raw: rehypeRaw, math: null }

export const REMARK_BASELINE_PROFILE = {
  id: 'fregat-gfm-math-cjk',
  html: 'loaded',
  math: 'fallback',
  chatHostPolicy: 'app-browser-only',
} satisfies Record<string, string>

export async function readyRemarkExtensions(): Promise<HastExtensions> {
  const { default: math } = await import('rehype-katex')
  return { raw: rehypeRaw, math }
}

export function canonicalHast(root: Root): string {
  return JSON.stringify(root)
}

export function createRemarkReplay(options: ReplayOptions = {}) {
  const session = createMarkdownSession({ remarkPlugins: options.remarkPlugins })
  const processor = createHastProcessor(options.extensions ?? LOADED_HTML)
  return {
    update(text: string, live: boolean): Root {
      return {
        type: 'root',
        children: session
          .update(text, { heal: live })
          .flatMap((block) => blockToHast(block, processor).children),
      }
    },
  }
}

export function renderRemark(text: string, live: boolean): Root {
  return createRemarkReplay().update(text, live)
}

export function observeHast(root: Root): Observation {
  const elements: ElementObservation[] = []
  visit(root, [], elements)
  return { text: nodeText(root), elements }
}

export function checkExpectations(
  observation: Observation,
  expectations: readonly Expectation[],
): string[] {
  return expectations.flatMap((expectation) => checkElement(observation, expectation))
}

function checkElement(observation: Observation, expectation: Expectation): string[] {
  const elements = observation.elements.filter((element) => element.tag === expectation.tag)
  const findings: string[] = []
  if (elements.length !== expectation.count) {
    findings.push(
      `${expectation.tag}: expected ${expectation.count} elements, received ${elements.length}`,
    )
  }
  if (expectation.texts) compareTexts(elements, expectation.texts, findings, expectation.tag)
  if (expectation.attributes)
    compareAttributes(elements, expectation.attributes, findings, expectation.tag)
  return findings
}

function compareTexts(
  elements: readonly ElementObservation[],
  texts: readonly string[],
  findings: string[],
  tag: string,
) {
  for (const [index, expected] of texts.entries()) {
    const actual = elements[index]?.text
    if (actual === expected) continue
    findings.push(
      `${tag}[${index}] text: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  }
}

function compareAttributes(
  elements: readonly ElementObservation[],
  attributes: readonly Readonly<Record<string, string | null>>[],
  findings: string[],
  tag: string,
) {
  for (const [index, expected] of attributes.entries()) {
    compareElementAttributes(elements[index], expected, findings, `${tag}[${index}]`)
  }
}

function compareElementAttributes(
  element: ElementObservation | undefined,
  expected: Readonly<Record<string, string | null>>,
  findings: string[],
  label: string,
) {
  for (const [name, value] of Object.entries(expected)) {
    const actual = element?.attributes[name] ?? null
    if (actual === value) continue
    findings.push(
      `${label} ${name}: expected ${JSON.stringify(value)}, received ${JSON.stringify(actual)}`,
    )
  }
}

function visit(node: Nodes, parents: readonly string[], elements: ElementObservation[]): void {
  const nextParents = node.type === 'element' ? parents.concat([node.tagName]) : parents
  if (node.type === 'element') {
    elements.push({
      tag: node.tagName,
      text: nodeText(node),
      attributes: attributesOf(node),
      parents,
    })
  }
  if (!('children' in node)) return
  for (const child of node.children) visit(child, nextParents, elements)
}

function nodeText(node: Nodes): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element' && node.tagName === 'br') return '\n'
  if (!('children' in node)) return ''
  return node.children.map(nodeText).join('')
}

function attributesOf(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const [key, value] of Object.entries(element.properties)) {
    if (value === null || value === undefined || value === false) continue
    attributes[attributeName(key)] = attributeValue(value)
  }
  return attributes
}

function attributeValue(value: string | number | boolean | readonly (string | number)[]): string {
  if (value === true) return ''
  if (Array.isArray(value)) return value.join(' ')
  return String(value)
}

function attributeName(key: string): string {
  if (key === 'className') return 'class'
  if (key === 'htmlFor') return 'for'
  if (key.startsWith('aria'))
    return key
      .replace(/([A-Z])/gu, (character) => character.toLowerCase())
      .replace(/^aria/u, 'aria-')
  return key.replace(/([A-Z])/gu, (character) => `-${character.toLowerCase()}`)
}
