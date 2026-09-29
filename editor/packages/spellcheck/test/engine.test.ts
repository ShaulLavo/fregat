import { beforeAll, describe, expect, it } from 'vitest'
import { inflateDictionary } from '../src/dictionaryData'
import { createSpellEngine, type SpellEngine } from '../src/engine'
import { bundledEngineSource, readDictionary } from './dictionaries'

let engine: SpellEngine

beforeAll(() => {
  engine = createSpellEngine(bundledEngineSource())
})

describe('createSpellEngine over the bundled dictionaries', () => {
  it('accepts known words and flags typos', () => {
    expect(engine.check(['the', 'list', 'settles', 'befor', 'cursor', 'arround'])).toEqual([
      'befor',
      'arround',
    ])
  })

  it('accepts both US and British spellings', () => {
    expect(engine.check(['behavior', 'behaviour', 'color', 'colour', 'initialise'])).toEqual([])
  })

  it('accepts software vocabulary', () => {
    expect(engine.check(['worktree', 'backend', 'repo'])).toEqual([])
  })

  it('accepts a capitalized dictionary word at a sentence start', () => {
    expect(engine.check(['Before', 'Settles'])).toEqual([])
  })

  it('suggests the intended word', () => {
    expect(engine.suggest('befor', 5)).toContain('before')
    expect(engine.suggest('recieve', 5)[0]).toBe('receive')
    expect(engine.suggest('Befor', 5)).toContain('Before')
  })

  it('honours accepted words in checks and suggestions', () => {
    engine.setAcceptedWords(['fregat'])
    expect(engine.check(['fregat', 'Fregat'])).toEqual([])
    expect(engine.suggest('fregatt', 5)).toContain('fregat')
    engine.setAcceptedWords([])
    expect(engine.check(['fregat'])).toEqual(['fregat'])
  })
})

describe('inflateDictionary', () => {
  it('inflates gzip bytes and passes already-inflated bytes through', async () => {
    const inflated = await inflateDictionary(readDictionary('english.trie.gz'))
    expect(inflated[0]).not.toBe(0x1f)
    expect(await inflateDictionary(inflated)).toBe(inflated)
  })
})
