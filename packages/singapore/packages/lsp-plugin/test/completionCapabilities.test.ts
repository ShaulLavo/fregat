import { afterEach, describe, expect, it } from 'vitest'

import { connectedEditor } from './connectedEditor'

/*
 * What the initialize request actually carries, read off the wire rather than off the record it was
 * built from: an item feature the client handles but never asks for is one no conforming server may
 * send, and every suite exercising it would be answering a question production never gets asked.
 */
describe('what the client tells the server it can receive', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('asks for both ranges an item can carry, and for the characters it may be accepted on', async () => {
    const editor = await connectedEditor('const va', 8)
    const completionItem =
      editor.initializeParams().capabilities.textDocument?.completion?.completionItem

    expect(completionItem?.insertReplaceSupport).toBe(true)
    expect(completionItem?.commitCharactersSupport).toBe(true)
  })
})
