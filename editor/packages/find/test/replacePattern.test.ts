import { describe, expect, it } from 'vitest'
import { parseReplaceString } from '../src/replacePattern'

function replace(target: string, search: RegExp, replaceString: string): string {
  return parseReplaceString(replaceString).buildReplaceString(search.exec(target))
}

describe('replace pattern', () => {
  it('expands escapes and leaves unrecognized ones alone', () => {
    const build = (replaceString: string) =>
      parseReplaceString(replaceString).buildReplaceString(null)

    expect(build('hello')).toBe('hello')
    expect(build('\\thello')).toBe('\thello')
    expect(build('h\\tello')).toBe('h\tello')
    expect(build('\\nhello')).toBe('\nhello')
    expect(build('\\\\thello')).toBe('\\thello')
    expect(build('\\\\\\thello')).toBe('\\\thello')
    expect(build('\\\\\\\\thello')).toBe('\\\\thello')

    // A trailing backslash, an unknown escape and a back reference all stay verbatim.
    expect(build('hello\\')).toBe('hello\\')
    expect(build('hello\\x')).toBe('hello\\x')
    expect(build('hello\\0')).toBe('hello\\0')
  })

  it('lets a backslash swallow the character it escapes', () => {
    // Without this, the '$' would be re-examined and parsed as a capture reference,
    // leaving no way to write a literal dollar other than '$$'.
    expect(replace('hi', /(hi)/, '\\$1')).toBe('\\$1')
    expect(replace('hi', /(hi)/, 'a\\$1b')).toBe('a\\$1b')
    expect(replace('hi', /(hi)/, '\\$&')).toBe('\\$&')

    // '$$' keeps working as the other way to write a literal dollar.
    expect(replace('hi', /(hi)/, '$$1')).toBe('$1')

    // An unknown escape before a capture reference must not eat the reference itself.
    expect(replace('hi', /(hi)/, '\\a$1')).toBe('\\ahi')
  })

  it('degrades an out-of-range capture index digit by digit', () => {
    expect(replace('hi', /(hi)/, 'hello$12')).toBe('hellohi2')
    expect(replace('hi', /(hi)/, 'hello$10')).toBe('hellohi0')
    expect(replace('hi', /(hi)/, 'hello$100')).toBe('hellohi00')
    expect(replace('hi', /(hi)/, 'hello$1a')).toBe('hellohia')

    // Only a first digit that is itself out of range falls back to a literal '$…'.
    expect(replace('hi', /(hi)/, 'hello$20')).toBe('hello$20')
    expect(replace('hi', /hi/, 'hello$9')).toBe('hello$9')

    // A capture that exists but did not participate contributes an empty string.
    expect(replace('hi', /(hi)()()()()()()()()()/, 'hello$10')).toBe('hello')
    expect(replace('abcd', /a(z)?/, 'a{$1}')).toBe('a{}')
  })

  it('matches JavaScript replace semantics', () => {
    const assertSameAsNative = (target: string, search: RegExp, replaceString: string) => {
      expect(replace(target, search, replaceString)).toBe(target.replace(search, replaceString))
    }

    assertSameAsNative('hi', /hi/, 'hello')
    assertSameAsNative('hi', /(hi)/, 'hello$1')
    assertSameAsNative('hi', /hi/, 'hello$&')
    assertSameAsNative('hi', /(hi)/, 'hello$10')
    assertSameAsNative('hi', /(hi)()()()()()()()()()/, 'hello$10')
    assertSameAsNative('hi', /(hi)/, 'hello$100')
    assertSameAsNative('hi', /(hi)/, 'hello$20')
    assertSameAsNative('hi', /(hi)/, 'hello$12')
    assertSameAsNative('hi', /hi/, 'hello$$')
  })

  it('applies case operations to the substituted capture only', () => {
    expect(replace('func privateFunc(', /func (\w+)\(/, 'func \\U$1(')).toBe('func PRIVATEFUNC(')
    expect(replace('func privateFunc(', /func (\w+)\(/, 'func \\u$1(')).toBe('func PrivateFunc(')
    expect(replace('func privateFunc(', /func (\w+)\(/, 'func \\L$1(')).toBe('func privatefunc(')
    expect(replace('func PrivateFunc(', /func (\w+)\(/, 'func \\l$1(')).toBe('func privateFunc(')
    expect(replace('hellogooDbye', /hello(\w+)/, 'hello\\u\\u\\l\\l\\U$1')).toBe('helloGOodBYE')
  })

  it('preserves the case of the match when asked', () => {
    const build = (matches: readonly string[], replaceString: string) =>
      parseReplaceString(replaceString).buildReplaceString(matches, true)

    expect(build(['abc'], 'Def')).toBe('def')
    expect(build(['Abc'], 'Def')).toBe('Def')
    expect(build(['ABC'], 'Def')).toBe('DEF')
    expect(build(['aBc'], 'DeF')).toBe('deF')
    expect(build(['Foo-Bar'], 'newfoo-newbar')).toBe('Newfoo-Newbar')
    expect(build(['foo-BAR'], 'newfoo-newbar')).toBe('newfoo-NEWBAR')
    expect(build(['Foo_Bar_abc'], 'newfoo_newbar')).toBe('Newfoo_newbar')
  })
})
