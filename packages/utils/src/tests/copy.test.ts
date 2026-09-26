import { describe, expect, it } from 'vitest'
import { contrastPhrase } from '../copy'

describe('contrastPhrase', () => {
  it('finds a contrast clause', () => {
    expect(contrastPhrase('Colours text, not latency.')).toBe(', not')
    expect(contrastPhrase('Shows it — not the other.')).toBe('— not')
    expect(contrastPhrase('Uses tabs rather than spaces.')).toBe('rather than')
    expect(contrastPhrase('Instead of waiting, it retries.')).toBe('Instead of')
  })

  it('passes a negated fact', () => {
    expect(contrastPhrase('That path is not a folder.')).toBeNull()
    expect(contrastPhrase('Does not register a server.')).toBeNull()
  })
})
