import { describe, expect, it } from 'vitest'
import { tokenizeSpellWords, type SpellTokenizeOptions } from '../src/tokenizer'

function words(text: string, options?: SpellTokenizeOptions): readonly string[] {
  return tokenizeSpellWords(text, options).map((word) => word.word)
}

describe('tokenizeSpellWords', () => {
  it('returns words with offsets into the text', () => {
    const text = 'the list settles befor the cursor'
    const found = tokenizeSpellWords(text)
    const befor = found.find((word) => word.word === 'befor')
    expect(befor).toEqual({ start: 17, end: 22, word: 'befor' })
    expect(text.slice(befor?.start, befor?.end)).toBe('befor')
    expect(found.map((word) => word.word)).toEqual([
      'the',
      'list',
      'settles',
      'befor',
      'the',
      'cursor',
    ])
  })

  it('skips paths', () => {
    expect(words('open src/app.ts and ./scripts/run.sh or C:\\Users\\me now')).toEqual([
      'open',
      'and',
      'or',
      'now',
    ])
  })

  it('skips URLs and email addresses', () => {
    expect(words('see https://exmaple.com/docz?q=1 or mail sombody@exmaple.org today')).toEqual([
      'see',
      'or',
      'mail',
      'today',
    ])
  })

  it('skips file names and dotted identifiers', () => {
    expect(words('edit index.ts and window.locaton here')).toEqual(['edit', 'and', 'here'])
  })

  it('skips caller-excluded ranges such as inline code and composer chips', () => {
    const text = 'run `npm instal` then ask @src/foo.ts abuot it'
    const code = { start: text.indexOf('`'), end: text.lastIndexOf('`') + 1 }
    const chip = { start: text.indexOf('@'), end: text.indexOf('.ts') + 3 }
    expect(words(text, { excluded: [chip, code] })).toEqual(['run', 'then', 'ask', 'abuot', 'it'])
  })

  it('never returns Hebrew or other non-English words', () => {
    expect(words('שלום עולם and naïve café straße')).toEqual(['and'])
  })

  it('skips camelCase, acronyms, and words with digits or underscores', () => {
    expect(words('call useState with HTML and CSS, not foo_bar or v8 or abc123')).toEqual([
      'call',
      'with',
      'and',
      'not',
      'or',
      'or',
    ])
  })

  it('keeps apostrophes inside a word and folds typographic ones', () => {
    const found = tokenizeSpellWords("it’s the user's 'quoted' word")
    expect(found.map((word) => word.word)).toEqual(["it's", 'the', "user's", 'quoted', 'word'])
    expect(found[3]).toEqual({ start: 17, end: 23, word: 'quoted' })
  })

  it('skips single letters', () => {
    expect(words('a b c go')).toEqual(['go'])
  })

  it('splits camelCase and snake_case in code mode', () => {
    const text = 'parseHTTPRespnse max_retrys getX'
    const found = tokenizeSpellWords(text, { mode: 'code' })
    expect(found.map((word) => word.word)).toEqual(['parse', 'Respnse', 'retrys'])
    const respnse = found[1]
    expect(text.slice(respnse?.start, respnse?.end)).toBe('Respnse')
  })
})
