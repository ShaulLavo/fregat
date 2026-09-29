import { describe, expect, it } from 'vitest'

import { createStringTextSnapshot } from '../documentTextSnapshot'
import { parseSnippet, snippetInitialSelection } from './snippet'

describe('parseSnippet', () => {
  it('returns plain text unchanged', () => {
    expect(parseSnippet('console.log')).toEqual({ stops: [], text: 'console.log' })
  })

  it('records a simple tab stop as a caret position', () => {
    const parsed = parseSnippet('foo($1)')

    expect(parsed.text).toBe('foo()')
    expect(parsed.stops).toEqual([{ index: 1, ranges: [{ end: 4, start: 4 }] }])
  })

  it('expands a placeholder to its default and selects it', () => {
    const parsed = parseSnippet('foo(${1:arg})')

    expect(parsed.text).toBe('foo(arg)')
    expect(parsed.stops).toEqual([{ index: 1, ranges: [{ end: 7, start: 4 }] }])
  })

  it('handles several placeholders in order', () => {
    const parsed = parseSnippet('${1:a}, ${2:b}')

    expect(parsed.text).toBe('a, b')
    expect(parsed.stops.map((stop) => stop.index)).toEqual([1, 2])
  })

  // $0 is where the caret leaves the snippet, so it is visited last however it is numbered.
  it('sorts the exit stop last', () => {
    const parsed = parseSnippet('if ($1) {\n  $0\n}')

    expect(parsed.stops.map((stop) => stop.index)).toEqual([1, 0])
  })

  it('groups repeated stops so they can be edited together', () => {
    const parsed = parseSnippet('$1 = $1')

    expect(parsed.stops).toEqual([
      {
        index: 1,
        ranges: [
          { end: 0, start: 0 },
          { end: 3, start: 3 },
        ],
      },
    ])
  })

  it('takes the first option of a choice as the default', () => {
    const parsed = parseSnippet('${1|public,private|} x')

    expect(parsed.text).toBe('public x')
    expect(parsed.stops[0]?.ranges).toEqual([{ end: 6, start: 0 }])
  })

  it('keeps a comma an option escaped rather than splitting on it', () => {
    const parsed = parseSnippet('${1|a\\,b,c|}')

    expect(parsed.text).toBe('a,b')
    expect(parsed.stops[0]?.ranges).toEqual([{ end: 3, start: 0 }])
  })

  it('expands ${1} with no default to an empty stop', () => {
    const parsed = parseSnippet('a${1}b')

    expect(parsed.text).toBe('ab')
    expect(parsed.stops[0]?.ranges).toEqual([{ end: 1, start: 1 }])
  })

  it('substitutes known variables and empties unknown ones', () => {
    expect(parseSnippet('$TM_SELECTED_TEXT!', { selection: 'hi' }).text).toBe('hi!')
    expect(parseSnippet('${TM_SELECTED_TEXT}!', { selection: 'hi' }).text).toBe('hi!')
    expect(parseSnippet('$NOT_A_THING!').text).toBe('!')
  })

  it('falls back to a variable default when the variable is empty', () => {
    expect(parseSnippet('${TM_SELECTED_TEXT:none}').text).toBe('none')
  })

  it('unescapes \\$, \\} and \\\\', () => {
    expect(parseSnippet('\\$1').text).toBe('$1')
    expect(parseSnippet('\\}').text).toBe('}')
    expect(parseSnippet('a\\\\b').text).toBe('a\\b')
  })

  it('leaves a bare dollar alone', () => {
    expect(parseSnippet('costs $ today').text).toBe('costs $ today')
  })

  it('keeps the stop a nested placeholder declares', () => {
    const parsed = parseSnippet('${1:outer ${2:inner}}')

    expect(parsed.text).toBe('outer inner')
    expect(parsed.stops).toEqual([
      { index: 1, ranges: [{ end: 11, start: 0 }] },
      { index: 2, ranges: [{ end: 11, start: 6 }] },
    ])
  })

  // A placeholder repeated inside another one is how a server writes `map(item => item)`, and it is
  // only a mirror if the inner occurrence survives being nested.
  it('groups a repeated stop across a nesting boundary', () => {
    const parsed = parseSnippet('(${1:item}) => ${2:${1:item}}')

    expect(parsed.text).toBe('(item) => item')
    expect(parsed.stops[0]).toEqual({
      index: 1,
      ranges: [
        { end: 5, start: 1 },
        { end: 14, start: 10 },
      ],
    })
  })

  it('leaves an unterminated placeholder as literal text', () => {
    expect(parseSnippet('${1:oops').text).toBe('${1:oops')
  })
})

describe('parseSnippet transforms', () => {
  it('upcases the placeholder a transform mirrors', () => {
    const parsed = parseSnippet('${1:name} ${1/(.*)/${1:/upcase}/}')

    expect(parsed.text).toBe('name NAME')
    expect(parsed.stops[0]?.ranges).toEqual([
      { end: 4, start: 0 },
      // The mirror carries what renders it, which is both what keeps the caret off it and what
      // lets it be rendered again from whatever the placeholder is typed into.
      { end: 9, start: 5, transform: expect.any(Function) },
    ])
  })

  // Rendering the mirror once and dropping what rendered it is what left a live mirror unable to
  // show anything but the default it was expanded with.
  it('hands back the transform a mirror can be rendered again with', () => {
    const parsed = parseSnippet('${1:name} ${1/(.*)/${1:/upcase}/}')

    expect(parsed.stops[0]?.ranges[1]?.transform?.('other')).toBe('OTHER')
  })

  it('puts the caret on the placeholder rather than on a mirror written above it', () => {
    const parsed = parseSnippet('${1/(.*)/${1:/upcase}/} ${1:name}')

    expect(parsed.text).toBe('NAME name')
    expect(snippetInitialSelection(parsed, 0)).toEqual({ end: 9, start: 5 })
  })

  // The mirror is free to come first, which is only readable once every default is known.
  it('reads a placeholder the transform precedes', () => {
    expect(parseSnippet('${1/(.*)/${1:/pascalcase}/} ${1:user name}').text).toBe(
      'UserName user name',
    )
  })

  it('transforms a variable in place, without leaving a stop behind', () => {
    const parsed = parseSnippet('${TM_SELECTED_TEXT/^(\\w+).*/${1:/capitalize}/}', {
      selection: 'abc def',
    })

    expect(parsed.text).toBe('Abc')
    expect(parsed.stops).toEqual([])
  })

  it('applies the remaining case shorthands', () => {
    const shorthand = (name: string, value: string) =>
      parseSnippet(`\${TM_SELECTED_TEXT/(.*)/\${1:/${name}}/}`, { selection: value }).text

    expect(shorthand('downcase', 'Loud')).toBe('loud')
    expect(shorthand('camelcase', 'user name')).toBe('userName')
    expect(shorthand('kebabcase', 'fooBar')).toBe('foo-bar')
    expect(shorthand('snakecase', 'fooBar')).toBe('foo_bar')
  })

  // A name that is not a shorthand must reach nothing, not a method the lookup inherited.
  it('leaves the capture alone for a shorthand it does not know', () => {
    expect(
      parseSnippet('${TM_SELECTED_TEXT/(.*)/${1:/toString}/}', { selection: 'kept' }).text,
    ).toBe('kept')
  })

  it('picks the branch a capture is written for', () => {
    const branching = '${TM_SELECTED_TEXT/(.+)/${1:?found:missing}/}'

    expect(parseSnippet(branching, { selection: 'x' }).text).toBe('found')
    expect(parseSnippet(branching, { selection: '' }).text).toBe('missing')
  })

  // Nothing matched, so there is no capture to substitute and nothing to fall back on either.
  it('leaves the value alone when nothing matches and no else branch exists', () => {
    expect(parseSnippet('${TM_SELECTED_TEXT/(\\d+)/[$1]/}', { selection: 'abc' }).text).toBe('abc')
  })

  it('replaces every occurrence under the g flag', () => {
    expect(parseSnippet('${TM_SELECTED_TEXT/a/-/g}', { selection: 'banana' }).text).toBe('b-n-n-')
  })

  // A dialect we cannot read still has to put its characters in the document.
  it('leaves a transform with an unusable regex as literal text', () => {
    expect(parseSnippet('${1/(/x/}').text).toBe('${1/(/x/}')
  })

  it('leaves an unrecognised placeholder body as literal text', () => {
    expect(parseSnippet('a${1 2}b').text).toBe('a${1 2}b')
  })
})

describe('parseSnippet indentation', () => {
  // Two spaces per level, so a snippet that arrives written in tabs has to be rewritten to match.
  const twoSpaceFile = 'function outer() {\n  if (ready) {\n    run()\n  }\n}\n'
  // Offset of the caret sitting at the end of `    run` on the third line.
  const insideTwoSpaceFile = twoSpaceFile.indexOf('run()') + 3

  it('leaves a snippet alone when nothing was asked about the document', () => {
    expect(parseSnippet('if ($1) {\n\t$0\n}').text).toBe('if () {\n\t\n}')
  })

  it("re-indents continuation lines to the caret's depth and the file's own unit", () => {
    const parsed = parseSnippet('if (${1:cond}) {\n\t$0\n}', {
      insertion: {
        textSnapshot: createStringTextSnapshot(twoSpaceFile),
        offset: insideTwoSpaceFile,
      },
    })

    expect(parsed.text).toBe('if (cond) {\n      \n    }')
  })

  it('moves the stops with the text they name', () => {
    const parsed = parseSnippet('if (${1:cond}) {\n\t$0\n}', {
      insertion: {
        textSnapshot: createStringTextSnapshot(twoSpaceFile),
        offset: insideTwoSpaceFile,
      },
    })

    expect(parsed.stops).toEqual([
      { index: 1, ranges: [{ end: 8, start: 4 }] },
      // Past the six spaces the second line now opens with, which is where the caret has to land
      // for the next thing typed to be part of the block.
      { index: 0, ranges: [{ end: 18, start: 18 }] },
    ])
  })

  it('keeps tabs when the line it lands on is indented with them', () => {
    const parsed = parseSnippet('if ($1) {\n  $0\n}', {
      insertion: {
        textSnapshot: createStringTextSnapshot('function outer() {\n\tif (ready) {\n\t}\n}\n'),
        offset: 21,
      },
    })

    expect(parsed.text).toBe('if () {\n\t\t\n\t}')
  })

  it('scales a snippet written in four spaces down to the file it lands in', () => {
    const parsed = parseSnippet('try {\n    ${1:body}\n} catch {}', {
      insertion: {
        textSnapshot: createStringTextSnapshot(twoSpaceFile),
        offset: insideTwoSpaceFile,
      },
    })

    expect(parsed.text).toBe('try {\n      body\n    } catch {}')
  })

  // Alignment is not a level: it was put there to line something up with the row above, and
  // rewriting it at another width would move it off whatever it was lined up with.
  it('carries left-over alignment across at the width it was written', () => {
    const parsed = parseSnippet('call(\n\t   arg,\n)', {
      insertion: {
        textSnapshot: createStringTextSnapshot(twoSpaceFile),
        offset: insideTwoSpaceFile,
      },
    })

    expect(parsed.text).toBe('call(\n         arg,\n    )')
  })

  it('adds nothing to a line the snippet left empty', () => {
    const parsed = parseSnippet('start\n\nend', {
      insertion: {
        textSnapshot: createStringTextSnapshot(twoSpaceFile),
        offset: insideTwoSpaceFile,
      },
    })

    expect(parsed.text).toBe('start\n\n    end')
  })

  // Rewriting on no evidence would be worse than leaving what the server sent.
  it('keeps the snippet as written when the document indents nothing', () => {
    const parsed = parseSnippet('a\n\tb', {
      insertion: { textSnapshot: createStringTextSnapshot('x\ny\n'), offset: 2 },
    })

    expect(parsed.text).toBe('a\n\tb')
  })
})

describe('snippetInitialSelection', () => {
  it('selects the first stop, offset into the document', () => {
    const parsed = parseSnippet('foo(${1:arg})')

    expect(snippetInitialSelection(parsed, 100)).toEqual({ end: 107, start: 104 })
  })

  it('lands at the end when the snippet has no stops', () => {
    const parsed = parseSnippet('done')

    expect(snippetInitialSelection(parsed, 10)).toEqual({ end: 14, start: 14 })
  })
})
