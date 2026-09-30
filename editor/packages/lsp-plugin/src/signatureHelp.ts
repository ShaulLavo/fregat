import type * as lsp from 'vscode-languageserver-protocol'

/**
 * What a typed character means for the signature widget.
 *
 * `open` and `argument` ask the server for help; `close` dismisses, because the call the widget was
 * describing has ended. Anything else leaves an open widget alone, so typing an argument does not
 * tear down the signature it belongs to.
 */
export type SignatureHelpTrigger =
  | { readonly kind: 'open'; readonly triggerCharacter: '(' }
  | { readonly kind: 'argument'; readonly triggerCharacter: ',' }
  | { readonly kind: 'close' }

export type SignatureHelpDisplay = {
  /** Markdown for the tooltip: the active signature, with its active parameter emphasized. */
  readonly markdown: string
  /** 0-based index of the signature shown, for overload cycling. */
  readonly activeSignature: number
  readonly signatureCount: number
}

/**
 * Read from the keystroke, never from the edit it caused. Auto-closing writes a typed `(` as the
 * two-character `()`, and typing over the closer it inserted moves the caret without changing any
 * text, so an edit-derived trigger misses both of the characters that matter.
 */
export function signatureHelpTriggerFromTypedText(text: string): SignatureHelpTrigger | null {
  if (text === '(') return { kind: 'open', triggerCharacter: '(' }
  if (text === ',') return { kind: 'argument', triggerCharacter: ',' }
  if (text === ')') return { kind: 'close' }

  return null
}

/**
 * Formats a server response for the tooltip, or null when there is nothing worth showing.
 *
 * `activeSignature` and `activeParameter` are optional in the protocol and some servers omit them
 * or send an out-of-range index, so both are clamped rather than trusted.
 */
export function formatSignatureHelp(
  help: lsp.SignatureHelp | null | undefined,
  overrideSignature?: number,
): SignatureHelpDisplay | null {
  const signatures = help?.signatures ?? []
  if (signatures.length === 0) return null

  const requested = overrideSignature ?? help?.activeSignature ?? 0
  const activeSignature = clampIndex(requested, signatures.length)
  const signature = signatures[activeSignature]
  if (!signature) return null

  const activeParameter = signature.activeParameter ?? help?.activeParameter ?? null
  const label = emphasizeActiveParameter(signature, activeParameter)
  const documentation = documentationText(signature.documentation)

  return {
    activeSignature,
    markdown: documentation ? `${label}\n\n${documentation}` : label,
    signatureCount: signatures.length,
  }
}

/**
 * Wraps the active parameter in bold. A parameter label is either a substring of the signature or
 * an explicit `[start, end]` range into it; the range form is authoritative because a name like
 * `x` would otherwise match the first `x` anywhere in the signature.
 */
function emphasizeActiveParameter(
  signature: lsp.SignatureInformation,
  activeParameter: number | null,
): string {
  const label = signature.label
  const parameters = signature.parameters ?? []
  if (activeParameter === null) return label

  const parameter = parameters[clampIndex(activeParameter, parameters.length)]
  if (!parameter) return label

  const range = parameterRange(label, parameter.label)
  if (!range) return label

  return `${label.slice(0, range.start)}**${label.slice(range.start, range.end)}**${label.slice(range.end)}`
}

function parameterRange(
  label: string,
  parameterLabel: lsp.ParameterInformation['label'],
): { readonly start: number; readonly end: number } | null {
  if (Array.isArray(parameterLabel)) {
    const [start, end] = parameterLabel
    if (start < 0 || end > label.length || start >= end) return null

    return { end, start }
  }

  const start = findTokenBoundedIndex(label, parameterLabel)
  if (start === -1) return null

  return { end: start + parameterLabel.length, start }
}

/**
 * First occurrence of `needle` that is not part of a longer identifier — a plain indexOf for the
 * parameter `a` in `add(a)` finds the `a` of "add".
 */
function findTokenBoundedIndex(label: string, needle: string): number {
  if (needle.length === 0) return -1

  let index = label.indexOf(needle)
  while (index !== -1) {
    const before = label[index - 1]
    const after = label[index + needle.length]
    if (!isIdentifierChar(before) && !isIdentifierChar(after)) return index

    index = label.indexOf(needle, index + 1)
  }

  return -1
}

function isIdentifierChar(char: string | undefined): boolean {
  if (char === undefined) return false

  return /[A-Za-z0-9_$]/.test(char)
}

function documentationText(
  documentation: lsp.SignatureInformation['documentation'],
): string | null {
  if (!documentation) return null
  if (typeof documentation === 'string') return documentation.trim() || null

  return documentation.value.trim() || null
}

/** Keeps an index inside `[0, length)`; servers do send out-of-range values. */
function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || index < 0) return 0
  if (index >= length) return Math.max(0, length - 1)

  return Math.trunc(index)
}

/** Next signature for overload cycling, wrapping at both ends. */
export function nextSignatureIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return 0

  return (((current + delta) % count) + count) % count
}
