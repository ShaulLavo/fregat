import {
  readTerminalPathLinks,
  type TerminalBufferLine,
  type TerminalBufferLineReader,
} from '@/features/terminal/utils/links'
import { expect, test } from '../../../../../test/fixtures'

const COLUMNS = 28
const ROOT = '/Users/dev/app'
/** What ghostty reports for a cell the shell never wrote to. */
const UNWRITTEN = '\u0000'

test('a stack-trace frame links the file, its line and its column', () => {
  const links = readTerminalPathLinks({
    getLine: buffer([row('  at run (src/index.ts:42:9)')]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links).toEqual([
    {
      range: { end: { x: 26, y: 0 }, start: { x: 10, y: 0 } },
      reference: {
        column: 9,
        label: 'src/index.ts:42:9',
        line: 42,
        path: '/Users/dev/app/src/index.ts',
      },
      text: 'src/index.ts:42:9',
    },
  ])
})

test('a path the emulator soft-wrapped across two rows is still one link', () => {
  // The halves are `…/app/src` and `/index.ts:42:9)`; neither reads as a file on
  // its own, so a detector working one row at a time finds nothing here.
  const links = readTerminalPathLinks({
    getLine: buffer([
      row('  at run (/Users/dev/app/src'),
      row('/index.ts:42:9)', { wrapped: true }),
    ]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links).toEqual([
    {
      range: { end: { x: 13, y: 1 }, start: { x: 10, y: 0 } },
      reference: {
        column: 9,
        label: 'src/index.ts:42:9',
        line: 42,
        path: '/Users/dev/app/src/index.ts',
      },
      text: '/Users/dev/app/src/index.ts:42:9',
    },
  ])
})

test('a wrapped path is found from its continuation row too', () => {
  const getLine = buffer([
    row('  at run (/Users/dev/app/src'),
    row('/index.ts:42:9)', { wrapped: true }),
  ])

  expect(readTerminalPathLinks({ getLine, rootPath: ROOT, row: 1 })).toEqual(
    readTerminalPathLinks({ getLine, rootPath: ROOT, row: 0 }),
  )
})

test('rows that merely sit next to each other are not joined', () => {
  const getLine = buffer([row('src/one.ts:1'), row('src/two.ts:2')])

  expect(readTerminalPathLinks({ getLine, rootPath: ROOT, row: 0 }).map(linkText)).toEqual([
    'src/one.ts:1',
  ])
})

test('cells the shell never wrote still hold their column', () => {
  // ghostty renders an untouched cell as nothing at all, so a line with a gap in
  // it would report the link several columns left of where it is painted.
  const links = readTerminalPathLinks({
    getLine: buffer([row(`run${UNWRITTEN.repeat(2)}src/a.ts:1`)]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links[0]?.range).toEqual({ end: { x: 14, y: 0 }, start: { x: 5, y: 0 } })
})

test('trailing prose punctuation is not part of the path', () => {
  const links = readTerminalPathLinks({
    getLine: buffer([row('wrote ./src/main.ts:12.')]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links.map(linkText)).toEqual(['./src/main.ts:12'])
  expect(links[0]?.reference.path).toBe('/Users/dev/app/src/main.ts')
})

test('a url is left to the emulator instead of opening as a file', () => {
  const links = readTerminalPathLinks({
    getLine: buffer([row('docs at https://example.com/a.ts')]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links).toEqual([])
})

test('a diagnostic label glued to a path is not part of the link', () => {
  // `ERROR:` reads as a URL scheme to the shared resolver, which killed the link
  // outright; the label is chrome, the path behind it is the thing to open.
  const links = readTerminalPathLinks({
    getLine: buffer([row('ERROR:src/a.ts:1 boom')]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links).toEqual([
    {
      range: { end: { x: 15, y: 0 }, start: { x: 6, y: 0 } },
      reference: {
        column: null,
        label: 'src/a.ts:1',
        line: 1,
        path: '/Users/dev/app/src/a.ts',
      },
      text: 'src/a.ts:1',
    },
  ])
})

test('a user agent string offers nothing to click', () => {
  // Every segment here is `name/version`, and a version suffix is exactly what a
  // file extension looks like — three links used to appear on this one line.
  const links = readTerminalPathLinks({
    getLine: buffer([row('ua Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36', { columns: 46 })]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links).toEqual([])
})

test('a host and port is not a file at a line', () => {
  const links = readTerminalPathLinks({
    getLine: buffer([row('serving example.com:8080', { columns: 26 })]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links).toEqual([])
})

test('output that merely looks path-shaped offers nothing to click', () => {
  // A package name, a runtime-internal module (`internal/main` names no file on
  // disk), an IP with a port, and prose all carry the shape without the substance.
  const getLine = buffer([
    row('lint @typescript-eslint/all'),
    row('at (node:internal/main:22:3)'),
    row('bound 127.0.0.1:5173 ok'),
    row('npm ERR! 3 problems and/or 1'),
  ])

  for (const index of [0, 1, 2, 3]) {
    expect(readTerminalPathLinks({ getLine, rootPath: ROOT, row: index })).toEqual([])
  }
})

test('a relative path stays unlinked while no root is known', () => {
  const getLine = buffer([row('  at run (src/index.ts:42:9)')])

  expect(readTerminalPathLinks({ getLine, rootPath: null, row: 0 })).toEqual([])
  expect(readTerminalPathLinks({ getLine, rootPath: ROOT, row: 0 })).toHaveLength(1)
})

test('an absolute path outside the root links by its full path', () => {
  const links = readTerminalPathLinks({
    getLine: buffer([row('open /tmp/build/out.log')]),
    rootPath: ROOT,
    row: 0,
  })

  expect(links[0]?.reference).toEqual({
    column: null,
    label: '/tmp/build/out.log',
    line: null,
    path: '/tmp/build/out.log',
  })
})

test('a row past the end of the buffer has no links', () => {
  expect(
    readTerminalPathLinks({ getLine: buffer([row('src/a.ts')]), rootPath: ROOT, row: 4 }),
  ).toEqual([])
})

test('a screen filled with one unbroken run scans in linear time', () => {
  // `openssl rand -hex 4000` on a 200x50 screen. ghostty calls the provider from
  // its mousemove handler and re-scans after every write, so this whole scan has
  // to fit inside a frame. The old backtracking scan took ~740ms here.
  const columns = 200
  const rows = 50
  const getLine = buffer(
    Array.from({ length: rows }, (_, index) =>
      row(hexRun(index, columns), { columns, wrapped: index > 0 }),
    ),
  )
  // Warm the path first: the budget measures scanning, not first-call compilation.
  readTerminalPathLinks({ getLine, rootPath: ROOT, row: 0 })

  const started = performance.now()
  const links = readTerminalPathLinks({ getLine, rootPath: ROOT, row: 0 })
  const elapsed = performance.now() - started

  expect(links).toEqual([])
  // 200ms, not 30: the defect this guards is catastrophic backtracking, which
  // is an order-of-magnitude failure (~740ms above), so 3.7x of headroom still
  // catches it — while 30ms was inside the noise of a machine running the rest
  // of the suite beside it, and went red there.
  //
  // If this flakes again, change the instrument rather than the number. A
  // wall-clock budget shared with 200 other test files measures the machine;
  // the honest deterministic form is a step-count on the scanner.
  expect(elapsed).toBeLessThan(200)
})

function hexRun(seed: number, length: number) {
  const digits = '0123456789abcdef'
  let run = ''
  for (let index = 0; index < length; index += 1) {
    run += digits[(seed * 7 + index * 11) % digits.length]
  }

  return run
}

function linkText(link: { readonly text: string }) {
  return link.text
}

function buffer(lines: readonly TerminalBufferLine[]): TerminalBufferLineReader {
  return (index) => lines[index]
}

function row(content: string, { columns = COLUMNS, wrapped = false } = {}): TerminalBufferLine {
  const codepoints = Array.from(
    content.padEnd(columns, UNWRITTEN),
    (character) => character.codePointAt(0) ?? 0,
  )

  return {
    getCell: (x) => {
      const codepoint = codepoints[x]
      if (codepoint === undefined) return undefined

      return { getCodepoint: () => codepoint }
    },
    isWrapped: wrapped,
    length: codepoints.length,
  }
}
