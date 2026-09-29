import { describe, expect, it } from 'vitest'

import { fuzzyMatch } from '../src/fuzzyMatch'

/** A pattern exactly as long as the budget allows, and a candidate it matches end to end. */
const BUDGETED_PATTERN = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 64)

/*
 * A score is never shown to anybody. What is shown is which entry sits at the top of the list, and
 * that is the one Enter takes — so every rule here is fixed by a pair of labels it alone decides
 * between. Retuning a constant stays free; dropping a rule does not.
 */
describe('the order fuzzy matching puts candidates in', () => {
  it('puts the label the typing spells out whole above one it is only the start of', () => {
    expect(rank('value', 'value', 'valueOf')).toEqual(['value', 'valueOf'])
  })

  it('puts the label whose match ends sooner above one that reaches further for it', () => {
    expect(rank('rf', 'readFile', 'readableFileStream')).toEqual(['readFile', 'readableFileStream'])
  })

  // Reaching for shift is not something a hand does by accident.
  it('puts the label written in the case that was typed above one that differs in it', () => {
    expect(rank('RF', 'ReadFile', 'readFile')).toEqual(['ReadFile', 'readFile'])
  })

  it('counts a letter across a separator for what a letter on a hump counts', () => {
    expect(rank('gt', 'get_token', 'getIdToken')).toEqual(['get_token', 'getIdToken'])
  })

  it('puts the label the typing runs through unbroken above one it has to jump a hole in', () => {
    expect(rank('errm', 'errMessage', 'errorMessage')).toEqual(['errMessage', 'errorMessage'])
  })

  // What sits before the first matched character is the distance between what was typed and what is
  // being offered for it.
  it('puts the label the match starts at the front of above one it starts partway into', () => {
    expect(rank('id', 'index', 'getId')).toEqual(['index', 'getId'])
  })

  it('puts a match that resumes where a word begins above one that resumes inside a word', () => {
    expect(rank('oc', 'on_dbl_click', 'onclick')).toEqual(['on_dbl_click', 'onclick'])
  })

  it('puts the label carrying the typing through one word above one that breaks it over capitals', () => {
    expect(rank('json', 'toJson', 'toJSON')).toEqual(['toJson', 'toJSON'])
  })
})

describe('the characters fuzzy matching marks', () => {
  // Two humps of a label can begin with the same letter, and marking the later one leaves the reader
  // looking at a highlight that does not account for the entry being in the list.
  it('marks the first place a letter could have landed rather than the last', () => {
    expect(fuzzyMatch('fb', 'fooBarBaz')?.positions).toEqual([0, 3])
  })
})

/*
 * Every item of a list is scored on every keystroke, and a server is free to send a whole minified
 * line as one label. Both axes of the table walk are cut to a fixed size so that label costs what
 * any other costs — a budget nothing asserts is one a later change can widen back to unbounded
 * without anything going red.
 */
describe('the budget fuzzy matching works inside', () => {
  it('requires every pattern character up to the budget and none of the ones past it', () => {
    expect(fuzzyMatch(`${BUDGETED_PATTERN.slice(0, 63)}!`, BUDGETED_PATTERN)).toBeNull()
    expect(fuzzyMatch(`${BUDGETED_PATTERN}!`, BUDGETED_PATTERN)?.positions).toHaveLength(64)
  })

  it('reads the candidate up to the budget and no further', () => {
    expect(fuzzyMatch('zoom', `${'x'.repeat(123)}-zoom`)?.positions).toEqual([124, 125, 126, 127])
    expect(fuzzyMatch('zoom', `${'x'.repeat(124)}-zoom`)).toBeNull()
  })
})

/**
 * The candidates in the order a list would show them.
 *
 * They are sorted from the reverse of the order they were passed, so a rule that stops deciding
 * between a pair leaves it the way it arrived rather than the way the test asked for.
 */
function rank(pattern: string, ...candidates: string[]): readonly string[] {
  return candidates
    .toReversed()
    .sort((left, right) => scoreOf(pattern, right) - scoreOf(pattern, left))
}

function scoreOf(pattern: string, candidate: string): number {
  const match = fuzzyMatch(pattern, candidate)
  if (!match) throw new Error(`${candidate} does not match ${pattern}`)
  return match.score
}
