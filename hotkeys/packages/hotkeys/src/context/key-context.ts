/** One level of the context stack: identifiers (`Editor`) and key/value pairs (`mode == full`). */
export type KeyContext = {
  readonly identifiers: ReadonlySet<string>
  readonly values: ReadonlyMap<string, string>
}

export type KeyContextInit = {
  readonly identifiers?: Iterable<string>
  readonly values?: Readonly<Record<string, string>> | Iterable<readonly [string, string]>
}

export function createKeyContext(init: KeyContextInit = {}): KeyContext {
  const values = init.values ?? []
  const entries = Symbol.iterator in values ? values : Object.entries(values)
  return {
    identifiers: new Set(init.identifiers ?? []),
    values: new Map(entries as Iterable<readonly [string, string]>),
  }
}

/**
 * Parses Zed's context shorthand: whitespace-separated identifiers and `key=value` pairs,
 * such as `Editor mode=full extension=md`.
 */
export function parseKeyContext(source: string): KeyContext {
  const identifiers: string[] = []
  const values: Array<[string, string]> = []
  const pattern = /([\p{L}\p{N}_-]+)\s*(?:=\s*([\p{L}\p{N}_-]+))?/uy
  let index = skipWhitespace(source, 0)
  while (index < source.length) {
    pattern.lastIndex = index
    const match = pattern.exec(source)
    if (!match)
      throw new SyntaxError(`Unexpected character ${JSON.stringify(source[index])} in key context`)
    const [, key, value] = match
    if (value === undefined) identifiers.push(key!)
    else values.push([key!, value])
    index = skipWhitespace(source, pattern.lastIndex)
  }
  return createKeyContext({ identifiers, values })
}

function skipWhitespace(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index]!)) index += 1
  return index
}
