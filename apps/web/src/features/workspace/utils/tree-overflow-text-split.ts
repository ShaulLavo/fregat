interface OverflowTextSplitOptions {
  priority?: 'start' | 'end' | 'equal'
  splitIndex?: number
  splitOffset?: number
  variant?: 'default' | 'fade' | 'native'
}

export type OverflowTextSplit = (
  contents: string,
  options?: OverflowTextSplitOptions,
) => [string, string]

export type OverflowTextSplitOffset = ['last' | 'first', number]

export type OverflowTextSplitRule =
  | 'center'
  | 'extension'
  | 'leaf-path'
  | number
  | OverflowTextSplitOffset
  | OverflowTextSplit

export interface ResolvedOverflowTextSplit {
  split: OverflowTextSplit
  splitIndex?: number
  splitOffset?: number
}

function isWhitespace(character: string | undefined): boolean {
  return character != null && /\s/.test(character)
}

function boundaryTouchesWhitespace(contents: string, index: number): boolean {
  return isWhitespace(contents[index - 1]) || isWhitespace(contents[index])
}

function findNearestWhitespaceFreeBoundary(contents: string, centerIndex: number): number {
  if (!boundaryTouchesWhitespace(contents, centerIndex)) return centerIndex

  for (let offset = 1; offset < contents.length; offset += 1) {
    const before = centerIndex - offset
    if (before > 0 && !boundaryTouchesWhitespace(contents, before)) return before

    const after = centerIndex + offset
    if (after < contents.length && !boundaryTouchesWhitespace(contents, after)) return after
  }

  return centerIndex
}

function getCenterSplitIndex(contents: string): number {
  return findNearestWhitespaceFreeBoundary(contents, Math.ceil(contents.length / 2))
}

function splitAtCenter(contents: string): [string, string] {
  const centerIndex = Math.ceil(contents.length / 2)
  return [contents.slice(0, centerIndex), contents.slice(centerIndex)]
}

const splitCenter: OverflowTextSplit = (contents) => {
  if (contents.length < 2) return [contents, '']

  const splitIndex = getCenterSplitIndex(contents)
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)]
}

const splitExtension: OverflowTextSplit = (contents) => {
  if (contents.length < 4) return [contents, '']

  const extensionIndex = contents.lastIndexOf('.') + 1
  const impliedExtensionLength = contents.length - extensionIndex
  const splitIndex =
    extensionIndex >= 1 && impliedExtensionLength <= 10
      ? extensionIndex
      : getCenterSplitIndex(contents)
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)]
}

const splitLeafPath: OverflowTextSplit = (contents) => {
  if (contents.length < 4) return [contents, '']

  const leafPathIndex = contents.lastIndexOf('/') + 1
  const impliedLeafPathLength = contents.length - leafPathIndex
  const splitIndex =
    leafPathIndex >= 1 && impliedLeafPathLength <= 25
      ? leafPathIndex
      : Math.ceil(contents.length / 2)
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)]
}

const splitByIndex: OverflowTextSplit = (contents, options = {}) => {
  if (typeof options.splitIndex !== 'number') return splitAtCenter(contents)

  return [contents.slice(0, options.splitIndex), contents.slice(options.splitIndex)]
}

const splitLast: OverflowTextSplit = (contents, options = {}) => {
  const splitOffset = options.splitOffset
  if (typeof splitOffset !== 'number' || splitOffset <= 0 || splitOffset >= contents.length) {
    return splitAtCenter(contents)
  }

  const splitIndex = contents.length - splitOffset
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)]
}

const splitFirst: OverflowTextSplit = (contents, options = {}) => {
  const splitOffset = options.splitOffset
  if (typeof splitOffset !== 'number' || splitOffset <= 0 || splitOffset >= contents.length) {
    return splitAtCenter(contents)
  }

  return [contents.slice(0, splitOffset), contents.slice(splitOffset)]
}

export function resolveOverflowTextSplit(rule: OverflowTextSplitRule): ResolvedOverflowTextSplit {
  if (typeof rule === 'function') return { split: rule }
  if (typeof rule === 'number') return { split: splitByIndex, splitIndex: rule }
  if (rule === 'extension') return { split: splitExtension }
  if (rule === 'leaf-path') return { split: splitLeafPath }
  if (!Array.isArray(rule)) return { split: splitCenter }

  const [offsetType, splitOffset] = rule
  if (offsetType === 'last') return { split: splitLast, splitOffset }
  return { split: splitFirst, splitOffset }
}
