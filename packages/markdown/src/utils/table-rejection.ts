import type {} from 'remark-parse'
import type { Data, Processor } from 'unified'

type Extension = NonNullable<Data['micromarkExtensions']>[number]
type Construct = Exclude<NonNullable<NonNullable<Extension['flow']>[string]>, unknown[]>
type Tokenizer = Construct['tokenize']
type Context = ThisParameterType<Tokenizer>
type Token = Context['events'][number][1]
type Rejection =
  | { readonly kind: 'pending'; readonly start: number }
  | { readonly kind: 'content'; readonly token: Token }

function contentOwner(chunk: Token, owners: WeakMap<Token, Token>): Token {
  const path: Token[] = []
  let current = chunk
  while (current.previous && !owners.has(current)) {
    path.push(current)
    current = current.previous
  }
  const owner = owners.get(current) ?? current
  owners.set(current, owner)
  for (const token of path) owners.set(token, owner)
  return owner
}

function openContent(
  events: readonly Context['events'][number][],
  owners: WeakMap<Token, Token>,
): Token | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const [kind, token] = events[index]
    if (token.type === 'lineEnding' || token.type === 'linePrefix') continue
    if (kind !== 'exit' || token.type !== 'chunkContent') return undefined
    return contentOwner(token, owners)
  }
}

function rejected(previous: Rejection | undefined, content: Token | undefined): boolean {
  if (!previous || !content) return false
  if (previous.kind === 'content') return previous.token === content
  return previous.start === content.start.offset
}

function isDelimiterRow([kind, token]: Context['events'][number]): boolean {
  const type: string = token.type
  return kind === 'enter' && type === 'tableDelimiterRow'
}

function completeDelimiter(context: Context, start: number): boolean {
  const event = context.events.slice(start).find(isDelimiterRow)
  if (!event || context.now().offset === event[1].start.offset) return false
  const value = context.sliceSerialize({ ...event[1], end: context.now() }, true)
  return /[|:]/u.test(value) && /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/u.test(value)
}

type Attempt = {
  readonly context: Context
  readonly from: number
  readonly rejection: Rejection
}
type State = Parameters<Tokenizer>[2]
type Rejections = WeakMap<Context['events'], Rejection>

function recordRejection(attempt: Attempt, rejections: Rejections, nok: State): State {
  return (code) => {
    // Keep rejection outside micromark's speculative event/stack rollback.
    if ((code === null || code < -2) && completeDelimiter(attempt.context, attempt.from)) {
      rejections.set(attempt.context.events, attempt.rejection)
    }
    return nok(code)
  }
}

function tableTokenizer(original: Tokenizer): Tokenizer {
  const rejections: Rejections = new WeakMap()
  const owners = new WeakMap<Token, Token>()
  return function (effects, ok, nok) {
    const content = openContent(this.events, owners)
    if (rejected(rejections.get(this.events), content)) return nok
    rejections.delete(this.events)
    const attempt: Attempt = {
      context: this,
      from: this.events.length,
      rejection: content
        ? { kind: 'content', token: content }
        : { kind: 'pending', start: this.now().offset },
    }
    return original.call(this, effects, ok, recordRejection(attempt, rejections, nok))
  }
}

function tableConstruct(construct: Construct): Construct {
  if (construct.name !== 'table') return construct
  return { ...construct, tokenize: tableTokenizer(construct.tokenize) }
}

// Pinned cmark-GFM keeps TABLE_VISITED on a rejected paragraph. GFM prose
// specifies matching cell counts, but does not explicitly specify retry suppression.
export function remarkTableRejection(this: Processor) {
  for (const extension of this.data('micromarkExtensions') ?? []) {
    const entry = extension.flow?.null
    if (!entry || !extension.flow) continue
    extension.flow.null = Array.isArray(entry) ? entry.map(tableConstruct) : tableConstruct(entry)
  }
}
