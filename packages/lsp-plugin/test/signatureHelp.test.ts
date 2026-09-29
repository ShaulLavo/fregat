import { describe, expect, it } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  formatSignatureHelp,
  nextSignatureIndex,
  signatureHelpTriggerFromTypedText,
} from '../src/signatureHelp'

describe('signatureHelpTriggerFromTypedText', () => {
  it('opens on an argument list', () => {
    expect(signatureHelpTriggerFromTypedText('(')).toEqual({
      kind: 'open',
      triggerCharacter: '(',
    })
  })

  it('re-requests on the next argument', () => {
    expect(signatureHelpTriggerFromTypedText(',')).toEqual({
      kind: 'argument',
      triggerCharacter: ',',
    })
  })

  // Auto-closing writes '()' for a typed '(' and types over its own closer without changing any
  // text, so this reads the keystroke; both characters still count.
  it('dismisses when the call closes', () => {
    expect(signatureHelpTriggerFromTypedText(')')).toEqual({ kind: 'close' })
  })

  // Typing an argument must not tear down the signature it belongs to.
  it('leaves ordinary typing alone', () => {
    expect(signatureHelpTriggerFromTypedText('x')).toBeNull()
  })

  it('ignores text that is not one of the trigger characters', () => {
    expect(signatureHelpTriggerFromTypedText('')).toBeNull()
    expect(signatureHelpTriggerFromTypedText('()')).toBeNull()
    expect(signatureHelpTriggerFromTypedText('\n')).toBeNull()
  })
})

const signature = (label: string, parameters: lsp.ParameterInformation[]) => ({
  label,
  parameters,
})

describe('formatSignatureHelp', () => {
  it('emphasizes the active parameter', () => {
    const help: lsp.SignatureHelp = {
      activeParameter: 1,
      activeSignature: 0,
      signatures: [
        signature('add(a: number, b: number)', [{ label: 'a: number' }, { label: 'b: number' }]),
      ],
    }

    expect(formatSignatureHelp(help)?.markdown).toBe('add(a: number, **b: number**)')
  })

  // A name like 'x' would match the first 'x' anywhere in the label, so the range form wins.
  it('prefers an explicit parameter range over substring search', () => {
    const help: lsp.SignatureHelp = {
      activeParameter: 0,
      activeSignature: 0,
      signatures: [signature('fx(x: number)', [{ label: [3, 12] }])],
    }

    expect(formatSignatureHelp(help)?.markdown).toBe('fx(**x: number**)')
  })

  it('appends documentation when the server sends it', () => {
    const help: lsp.SignatureHelp = {
      activeParameter: 0,
      activeSignature: 0,
      signatures: [
        { documentation: 'Adds numbers.', label: 'add(a)', parameters: [{ label: 'a' }] },
      ],
    }

    expect(formatSignatureHelp(help)?.markdown).toBe('add(**a**)\n\nAdds numbers.')
  })

  it('reports the overload count for cycling', () => {
    const help: lsp.SignatureHelp = {
      activeSignature: 1,
      signatures: [signature('f()', []), signature('f(a)', [{ label: 'a' }])],
    }

    const display = formatSignatureHelp(help)
    expect(display?.activeSignature).toBe(1)
    expect(display?.signatureCount).toBe(2)
  })

  it('shows a requested overload instead of the server default', () => {
    const help: lsp.SignatureHelp = {
      activeSignature: 0,
      signatures: [signature('f()', []), signature('f(a)', [{ label: 'a' }])],
    }

    expect(formatSignatureHelp(help, 1)?.markdown).toBe('f(a)')
  })

  it('clamps indices the server sends out of range', () => {
    const help: lsp.SignatureHelp = {
      activeParameter: 9,
      activeSignature: 9,
      signatures: [signature('f(a)', [{ label: 'a' }])],
    }

    const display = formatSignatureHelp(help)
    expect(display?.activeSignature).toBe(0)
    expect(display?.markdown).toBe('f(**a**)')
  })

  it('renders the bare label when there is no active parameter', () => {
    const help: lsp.SignatureHelp = { signatures: [signature('f(a)', [{ label: 'a' }])] }

    expect(formatSignatureHelp(help)?.markdown).toBe('f(a)')
  })

  it('has nothing to show without signatures', () => {
    expect(formatSignatureHelp(null)).toBeNull()
    expect(formatSignatureHelp({ signatures: [] })).toBeNull()
  })
})

describe('nextSignatureIndex', () => {
  it('cycles forward and wraps', () => {
    expect(nextSignatureIndex(0, 3, 1)).toBe(1)
    expect(nextSignatureIndex(2, 3, 1)).toBe(0)
  })

  it('cycles backward and wraps', () => {
    expect(nextSignatureIndex(0, 3, -1)).toBe(2)
  })

  it('is safe with no signatures', () => {
    expect(nextSignatureIndex(0, 0, 1)).toBe(0)
  })
})
