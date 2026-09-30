import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext } from './context'
import { documentationMarkdown } from './hover'
import { isRecord, positionParam } from './protocol'

export const SIGNATURE_HELP_TRIGGER_CHARACTERS = ['(', ',', '<']
export const SIGNATURE_HELP_RETRIGGER_CHARACTERS = [')']

const SIGNATURE_HELP_TRIGGER_CHARACTER = 2
const SIGNATURE_HELP_CONTENT_CHANGE = 3

/**
 * `labelOffsets` is the client's `parameterInformation.labelOffsetSupport`: with it a parameter
 * names its slice of the signature label, which a label repeated in the signature cannot do.
 */
export function signatureHelp(
  ctx: DocumentContext,
  params: unknown,
  labelOffsets: boolean,
): lsp.SignatureHelp | null {
  const position = positionParam(params)
  if (!position) return null

  const help = ctx.env.languageService.getSignatureHelpItems(
    ctx.document.fileName,
    ctx.lines.offset(position),
    { triggerReason: triggerReason(params) },
  )
  if (!help) return null

  const activeSignature = help.selectedItemIndex
  return {
    signatures: help.items.map((item) => signatureInformation(item, labelOffsets)),
    activeSignature,
    activeParameter: activeParameter(help, activeSignature),
  }
}

function signatureInformation(
  item: ts.SignatureHelpItem,
  labelOffsets: boolean,
): lsp.SignatureInformation {
  const separator = ts.displayPartsToString(item.separatorDisplayParts)
  let label = ts.displayPartsToString(item.prefixDisplayParts)
  const parameters: lsp.ParameterInformation[] = []

  item.parameters.forEach((parameter, index) => {
    if (index > 0) label += separator
    const parameterLabel = ts.displayPartsToString(parameter.displayParts)
    parameters.push({
      label: labelOffsets ? [label.length, label.length + parameterLabel.length] : parameterLabel,
      documentation: markdown(documentationMarkdown('', parameter.documentation, [])),
    })
    label += parameterLabel
  })
  label += ts.displayPartsToString(item.suffixDisplayParts)

  const tags = item.tags.filter((tag) => tag.name !== 'param')
  return {
    label,
    documentation: markdown(documentationMarkdown('', item.documentation, tags)),
    parameters,
  }
}

/** A rest parameter keeps absorbing arguments, so it stays active past its own index. */
function activeParameter(help: ts.SignatureHelpItems, activeSignature: number): number {
  const signature = help.items[activeSignature]
  if (!signature?.isVariadic) return help.argumentIndex
  return Math.min(help.argumentIndex, signature.parameters.length - 1)
}

function triggerReason(params: unknown): ts.SignatureHelpTriggerReason {
  const context = isRecord(params) && isRecord(params.context) ? params.context : null
  if (!context) return { kind: 'invoked' }

  const character = typeof context.triggerCharacter === 'string' ? context.triggerCharacter : null
  const retrigger = context.isRetrigger === true
  if (context.triggerKind === SIGNATURE_HELP_TRIGGER_CHARACTER && character) {
    if (retrigger) {
      return {
        kind: 'retrigger',
        triggerCharacter: character as ts.SignatureHelpRetriggerCharacter,
      }
    }
    return {
      kind: 'characterTyped',
      triggerCharacter: character as ts.SignatureHelpTriggerCharacter,
    }
  }
  if (context.triggerKind === SIGNATURE_HELP_CONTENT_CHANGE && retrigger)
    return { kind: 'retrigger' }
  return { kind: 'invoked' }
}

function markdown(value: string): lsp.MarkupContent | undefined {
  if (!value) return undefined
  return { kind: 'markdown', value }
}
