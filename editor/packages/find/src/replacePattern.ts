export class ReplacePattern {
  public static fromStaticValue(value: string): ReplacePattern {
    return new ReplacePattern([{ kind: 'static', value }])
  }

  public readonly hasReplacementPatterns: boolean

  public constructor(private readonly pieces: readonly ReplacePiece[]) {
    this.hasReplacementPatterns = pieces.some((piece) => piece.kind !== 'static')
  }

  public buildReplaceString(matches: readonly string[] | null, preserveCase = false): string {
    if (!this.hasReplacementPatterns) {
      const value = this.pieces[0]?.kind === 'static' ? this.pieces[0].value : ''
      return preserveCase ? buildReplaceStringWithCasePreserved(matches, value) : value
    }

    let result = ''
    for (const piece of this.pieces) {
      result += replacePieceValue(piece, matches)
    }
    return result
  }
}

type ReplacePiece =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'match'; readonly index: number; readonly caseOps: readonly string[] }

export function parseReplaceString(replaceString: string): ReplacePattern {
  if (replaceString.length === 0) return new ReplacePattern([])

  const builder = new ReplacePieceBuilder(replaceString)
  const caseOps: string[] = []
  for (let index = 0; index < replaceString.length; index += 1) {
    const nextIndex = consumeReplaceEscape(replaceString, index, builder, caseOps)
    if (nextIndex !== index) {
      index = nextIndex
      continue
    }

    index = consumeReplaceDollar(replaceString, index, builder, caseOps)
  }

  return builder.finalize()
}

function buildReplaceStringWithCasePreserved(
  matches: readonly string[] | null,
  pattern: string,
): string {
  const match = matches?.[0]
  if (!match) return pattern

  const hyphenated = validateSpecificSpecialCharacter(match, pattern, '-')
  const underscored = validateSpecificSpecialCharacter(match, pattern, '_')
  if (hyphenated && !underscored) return buildReplaceStringForSpecialCharacter(match, pattern, '-')
  if (!hyphenated && underscored) return buildReplaceStringForSpecialCharacter(match, pattern, '_')
  if (match.toLocaleUpperCase() === match) return pattern.toLocaleUpperCase()
  if (match.toLocaleLowerCase() === match) return pattern.toLocaleLowerCase()
  if (startsWithUppercase(match) && pattern.length > 0) return upperFirst(pattern)
  if (!startsWithUppercase(match) && pattern.length > 0) return lowerFirst(pattern)
  return pattern
}

class ReplacePieceBuilder {
  private readonly pieces: ReplacePiece[] = []
  private lastIndex = 0
  private staticValue = ''

  public constructor(private readonly source: string) {}

  public emitUnchanged(toIndex: number): void {
    this.appendStatic(this.source.slice(this.lastIndex, toIndex))
    this.lastIndex = toIndex
  }

  public emitStatic(value: string, toIndex: number): void {
    this.appendStatic(value)
    this.lastIndex = toIndex
  }

  public emitMatch(index: number, toIndex: number, caseOps: readonly string[]): void {
    this.flushStatic()
    this.pieces.push({ kind: 'match', index, caseOps: [...caseOps] })
    this.lastIndex = toIndex
  }

  public finalize(): ReplacePattern {
    this.emitUnchanged(this.source.length)
    this.flushStatic()
    return new ReplacePattern(this.pieces)
  }

  private appendStatic(value: string): void {
    if (value.length === 0) return
    this.staticValue += value
  }

  private flushStatic(): void {
    if (this.staticValue.length === 0) return

    this.pieces.push({ kind: 'static', value: this.staticValue })
    this.staticValue = ''
  }
}

function consumeReplaceEscape(
  source: string,
  index: number,
  builder: ReplacePieceBuilder,
  caseOps: string[],
): number {
  if (source[index] !== '\\') return index
  if (index + 1 >= source.length) return index

  const next = source[index + 1]!
  const staticValue = escapeStaticValue(next)
  if (staticValue !== null) {
    builder.emitUnchanged(index)
    builder.emitStatic(staticValue, index + 2)
    return index + 1
  }

  // An unrecognized escape still swallows the escaped character, so `\$1` stays literal
  // instead of the '$' being re-read as a capture reference by consumeReplaceDollar.
  if (!isCaseOperation(next)) return index + 1

  builder.emitUnchanged(index)
  builder.emitStatic('', index + 2)
  caseOps.push(next)
  return index + 1
}

function consumeReplaceDollar(
  source: string,
  index: number,
  builder: ReplacePieceBuilder,
  caseOps: string[],
): number {
  if (source[index] !== '$') return index
  if (index + 1 >= source.length) return index

  const next = source[index + 1]!
  if (next === '$') {
    builder.emitUnchanged(index)
    builder.emitStatic('$', index + 2)
    return index + 1
  }

  if (next === '&' || next === '0') {
    builder.emitUnchanged(index)
    builder.emitMatch(0, index + 2, caseOps)
    caseOps.length = 0
    return index + 1
  }

  return consumeReplaceCapture(source, index, builder, caseOps)
}

function consumeReplaceCapture(
  source: string,
  index: number,
  builder: ReplacePieceBuilder,
  caseOps: string[],
): number {
  const first = source[index + 1]!
  if (!isNonZeroDigit(first)) return index

  const second = source[index + 2]
  const hasSecondDigit = second !== undefined && isDigit(second)
  const capture = hasSecondDigit ? Number(`${first}${second}`) : Number(first)
  const end = hasSecondDigit ? index + 3 : index + 2
  builder.emitUnchanged(index)
  builder.emitMatch(capture, end, caseOps)
  caseOps.length = 0
  return end - 1
}

function replacePieceValue(piece: ReplacePiece, matches: readonly string[] | null): string {
  if (piece.kind === 'static') return piece.value

  const value = substituteMatch(piece.index, matches)
  return applyCaseOperations(value, piece.caseOps)
}

function substituteMatch(index: number, matches: readonly string[] | null): string {
  if (!matches) return ''
  if (index === 0) return matches[0] ?? ''

  // An out-of-range index degrades digit by digit, the way JavaScript's own String.replace
  // does: with a single capture group `$12` is group 1 followed by a literal '2', and only a
  // first digit that is also out of range falls back to the literal `$…`.
  let captureIndex = index
  let remainder = ''
  while (captureIndex > 0) {
    if (captureIndex < matches.length) return `${matches[captureIndex] ?? ''}${remainder}`

    remainder = `${captureIndex % 10}${remainder}`
    captureIndex = Math.floor(captureIndex / 10)
  }
  return `$${remainder}`
}

function applyCaseOperations(value: string, caseOps: readonly string[]): string {
  if (caseOps.length === 0) return value

  let opIndex = 0
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const op = caseOps[opIndex]
    if (!op) {
      result += value.slice(index)
      break
    }

    result += applyCaseOperation(value[index]!, op)
    if (op === 'u' || op === 'l') opIndex += 1
  }
  return result
}

function escapeStaticValue(value: string): string | null {
  if (value === '\\') return '\\'
  if (value === 'n') return '\n'
  if (value === 't') return '\t'
  return null
}

function isCaseOperation(value: string): boolean {
  return value === 'u' || value === 'U' || value === 'l' || value === 'L'
}

function applyCaseOperation(value: string, operation: string): string {
  if (operation === 'u' || operation === 'U') return value.toLocaleUpperCase()
  if (operation === 'l' || operation === 'L') return value.toLocaleLowerCase()
  return value
}

function validateSpecificSpecialCharacter(
  match: string,
  pattern: string,
  separator: string,
): boolean {
  if (!match.includes(separator) || !pattern.includes(separator)) return false
  return match.split(separator).length === pattern.split(separator).length
}

function buildReplaceStringForSpecialCharacter(
  match: string,
  pattern: string,
  separator: string,
): string {
  const matchParts = match.split(separator)
  return pattern
    .split(separator)
    .map((part, index) => buildReplaceStringWithCasePreserved([matchParts[index] ?? ''], part))
    .join(separator)
}

function startsWithUppercase(value: string): boolean {
  const first = value[0]
  return first !== undefined && first.toLocaleUpperCase() === first
}

function upperFirst(value: string): string {
  return `${value[0]!.toLocaleUpperCase()}${value.slice(1)}`
}

function lowerFirst(value: string): string {
  return `${value[0]!.toLocaleLowerCase()}${value.slice(1)}`
}

function isDigit(value: string): boolean {
  return value >= '0' && value <= '9'
}

function isNonZeroDigit(value: string): boolean {
  return value >= '1' && value <= '9'
}
