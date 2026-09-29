import { describe, expect, it } from 'vitest'

import { defaultClientCapabilities, mergeClientCapabilities } from '../src/capabilities'
import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  semanticTokensClientCapability,
} from '../src/semanticTokens'

const semanticTokensOf = (capabilities: ReturnType<typeof semanticTokensClientCapability>) =>
  capabilities.textDocument?.semanticTokens

describe('defaultClientCapabilities', () => {
  it('requests definition links with the server-provided source range', () => {
    expect(defaultClientCapabilities().textDocument?.definition?.linkSupport).toBe(true)
  })

  it('prefers Markdown hover content so servers preserve syntax-highlightable code fences', () => {
    expect(defaultClientCapabilities().textDocument?.hover?.contentFormat).toEqual([
      'markdown',
      'plaintext',
    ])
  })

  /**
   * The absence is the design, not an oversight. A client that declares semantic tokens commits
   * every server it speaks to to computing them, and the content of the block is the host's — one
   * real server computes its legend as the intersection of its own token types with the client's,
   * which makes the declaration an input to the server rather than a local decoding table.
   */
  it('declares no semantic-tokens block', () => {
    expect(defaultClientCapabilities().textDocument?.semanticTokens).toBeUndefined()
  })

  it('declares document pull diagnostics with tags and server refresh support', () => {
    const capabilities = defaultClientCapabilities()

    expect(capabilities.textDocument?.diagnostic).toEqual({
      dynamicRegistration: false,
      relatedDocumentSupport: false,
      tagSupport: { valueSet: [1, 2] },
    })
    expect(capabilities.workspace?.diagnostics?.refreshSupport).toBe(true)
  })
})

describe('semanticTokensClientCapability', () => {
  it('defaults to the standard vocabulary', () => {
    const semanticTokens = semanticTokensOf(
      semanticTokensClientCapability({ requests: { full: true } }),
    )

    expect(semanticTokens?.tokenTypes).toEqual([...SEMANTIC_TOKEN_TYPES])
    expect(semanticTokens?.tokenModifiers).toEqual([...SEMANTIC_TOKEN_MODIFIERS])
    expect(semanticTokens?.formats).toEqual(['relative'])
    expect(semanticTokens?.requests).toEqual({ full: true })
  })

  it('carries what the caller chose, verbatim', () => {
    const semanticTokens = semanticTokensOf(
      semanticTokensClientCapability({
        augmentsSyntaxTokens: true,
        requests: { full: { delta: true }, range: true },
        tokenModifiers: ['readonly', 'zigStyle'],
        tokenTypes: ['variable', 'zigBuiltin'],
      }),
    )

    expect(semanticTokens?.requests).toEqual({ full: { delta: true }, range: true })
    expect(semanticTokens?.tokenTypes).toEqual(['variable', 'zigBuiltin'])
    expect(semanticTokens?.tokenModifiers).toEqual(['readonly', 'zigStyle'])
    expect(semanticTokens?.augmentsSyntaxTokens).toBe(true)
  })

  it('round-trips through a merge over the defaults', () => {
    const declared = semanticTokensClientCapability({
      requests: { full: { delta: true }, range: true },
      tokenTypes: ['variable', 'function'],
      tokenModifiers: ['readonly'],
    })
    const merged = mergeClientCapabilities(defaultClientCapabilities(), declared)
    const semanticTokens = merged.textDocument?.semanticTokens

    expect(semanticTokens?.requests).toEqual({ full: { delta: true }, range: true })
    expect(semanticTokens?.tokenTypes).toEqual(['variable', 'function'])
    expect(semanticTokens?.tokenModifiers).toEqual(['readonly'])
    // The merge adds rather than replaces: everything the defaults declared is still there.
    expect(merged.general?.positionEncodings).toEqual(['utf-16'])
    expect(merged.textDocument?.completion?.completionItem?.snippetSupport).toBe(true)
  })

  /**
   * Absent, never `false`. There is no option that emits either key, because an undeclared
   * capability is what the wire means by "no" — and a key present with `false` is a *different*
   * statement that some servers branch on separately. A test asserting `=== false` here would be
   * asserting something this builder cannot produce.
   */
  it('cannot express overlappingTokenSupport or dynamicRegistration at all', () => {
    const semanticTokens = semanticTokensOf(
      semanticTokensClientCapability({ requests: { full: true } }),
    )

    expect(semanticTokens && 'overlappingTokenSupport' in semanticTokens).toBe(false)
    expect(semanticTokens && 'dynamicRegistration' in semanticTokens).toBe(false)
    expect(semanticTokens && 'augmentsSyntaxTokens' in semanticTokens).toBe(false)
  })

  /**
   * The one flag of the three that was ever temporary. It was refused until the paint layer was
   * proved to render a span crossing a newline across two mounted rows; that assertion lives in
   * `packages/editor/test/semanticTokenPaintOrder.test.ts` and passes, so the gate is open.
   */
  it('declares multilineTokenSupport when the caller asks, and omits the key otherwise', () => {
    expect(
      semanticTokensOf(
        semanticTokensClientCapability({ requests: { full: true }, multilineTokenSupport: true }),
      )?.multilineTokenSupport,
    ).toBe(true)

    const undeclared = semanticTokensOf(
      semanticTokensClientCapability({ requests: { full: true } }),
    )
    expect(undeclared && 'multilineTokenSupport' in undeclared).toBe(false)
  })

  it('copies the arrays it is given, so a caller cannot mutate a declared block', () => {
    const tokenTypes = ['variable']
    const declared = semanticTokensOf(
      semanticTokensClientCapability({ requests: { full: true }, tokenTypes }),
    )
    tokenTypes.push('mutated')

    expect(declared?.tokenTypes).toEqual(['variable'])
  })
})
