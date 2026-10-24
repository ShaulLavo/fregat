import { describe, expect, it } from 'vitest'

import { nextWordPartOffset, previousWordPartOffset } from '../src/textRanges'

/** Walks the whole string, so a test reads as the subwords a caret would visit. */
function forwardStops(text: string): string[] {
  const stops: string[] = []
  let offset = 0
  let previous = -1

  while (offset < text.length && offset !== previous) {
    previous = offset
    const next = nextWordPartOffset(text, offset)
    if (next === offset) break

    stops.push(text.slice(offset, next))
    offset = next
  }

  return stops
}

describe('nextWordPartOffset', () => {
  it('splits camelCase', () => {
    expect(forwardStops('parseValue')).toEqual(['parse', 'Value'])
  })

  it('splits snake_case and drops the separators onto the following word', () => {
    expect(forwardStops('read_file_sync')).toEqual(['read', '_file', '_sync'])
  })

  // HTTPResponse must not read as HTTPR | esponse.
  it('keeps an acronym together and breaks before the word that follows it', () => {
    expect(forwardStops('parseHTTPResponse')).toEqual(['parse', 'HTTP', 'Response'])
  })

  it('breaks between digits and letters', () => {
    expect(forwardStops('utf8Encode')).toEqual(['utf8', 'Encode'])
  })

  it('stops at the end of the text', () => {
    expect(nextWordPartOffset('abc', 3)).toBe(3)
    expect(nextWordPartOffset('', 0)).toBe(0)
  })

  it('steps over punctuation to reach the next word', () => {
    expect(forwardStops('a.b')).toEqual(['a', '.b'])
  })
})

describe('previousWordPartOffset', () => {
  it('walks back over camelCase', () => {
    expect(previousWordPartOffset('parseValue', 10)).toBe(5)
    expect(previousWordPartOffset('parseValue', 5)).toBe(0)
  })

  it('walks back over snake_case', () => {
    expect(previousWordPartOffset('read_file', 9)).toBe(5)
  })

  it('walks back over an acronym as one unit', () => {
    expect(previousWordPartOffset('parseHTTPResponse', 17)).toBe(9)
    expect(previousWordPartOffset('parseHTTPResponse', 9)).toBe(5)
  })

  it('stops at the start of the text', () => {
    expect(previousWordPartOffset('abc', 0)).toBe(0)
  })

  it('is the inverse of moving forward across a simple identifier', () => {
    const text = 'oneTwoThree'
    const forward = nextWordPartOffset(text, 0)

    expect(previousWordPartOffset(text, nextWordPartOffset(text, forward))).toBe(forward)
  })
})
