import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import { emptyAddress, formatAddress, parseAddress } from '@workspace/client-core/address/grammar'
import type { Address } from '@workspace/client-core/address/grammar'

function fixedPoint(href: string) {
  const once = formatAddress(parseAddress(href))

  expect(formatAddress(parseAddress(once))).toBe(once)
  return once
}

describe('the path', () => {
  test('treats `/` as no address at all', () => {
    expect(parseAddress('/')).toEqual(emptyAddress())
    expect(formatAddress(emptyAddress())).toBe('/')
  })

  test('names a workspace, a mode and a document', () => {
    const address = parseAddress(
      `/~${testWorkspaceToken('platform')}/workbench/f/apps/web/src/main.tsx`,
    )

    expect(address.workspace).toBe(testWorkspaceToken('platform'))
    expect(address.mode).toBe('workbench')
    expect(address.document).toBe('f/apps/web/src/main.tsx')
  })

  test('carries `/~-` for a remembered app with no folder open', () => {
    expect(parseAddress('/~-?settings=Providers')).toMatchObject({
      settings: 'Providers',
      workspace: '-',
    })
    expect(fixedPoint('/~-?settings=Providers')).toBe('/~-?settings=Providers')
  })

  test('ignores a top-level segment that is not a workspace', () => {
    expect(parseAddress('/workbench/f/a.ts').workspace).toBeNull()
  })

  test('falls back to the remembered mode on an unknown one, keeping the rest', () => {
    const address = parseAddress(`/~${testWorkspaceToken('platform')}/wrkbnch/f/x?side=git`)

    expect(address.mode).toBeNull()
    expect(address.side).toBe('git')
  })
})

describe('the fragment', () => {
  test('parses a line, a line and column, and a range', () => {
    expect(parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#L484`).focus).toEqual({
      column: null,
      endLine: null,
      line: 484,
    })
    expect(parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#L21,9`).focus).toMatchObject(
      { column: 9, line: 21 },
    )
    expect(
      parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#L484-L520`).focus,
    ).toMatchObject({
      endLine: 520,
      line: 484,
    })
  })

  test('round-trips each form to a fixed point', () => {
    for (const hash of ['#L484', '#L21,9', '#L484-L520']) {
      expect(fixedPoint(`/~${testWorkspaceToken('p')}/workbench/f/a.ts${hash}`)).toBe(
        `/~${testWorkspaceToken('p')}/workbench/f/a.ts${hash}`,
      )
    }
  })

  test('drops a fragment it cannot read rather than guessing', () => {
    expect(parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#nonsense`).focus).toBeNull()
    expect(parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#L0`).focus).toBeNull()
  })

  /**
   * Every part is validated, not just the line. A 0 column is not a position the 1-based
   * grammar can mean — and `serializeFocus` drops it as falsy, so it cannot even survive
   * a round trip — while a reversed range is a selection the editor would have to apply
   * backwards. Neither is emittable, so both are hand-edited input.
   */
  test('drops a column or a range the encoder could never emit', () => {
    expect(parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#L10,0`).focus).toBeNull()
    expect(parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#L20-L10`).focus).toBeNull()
    // The boundary stays legal: a one-line range is how a single-line selection reads.
    expect(
      parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts#L20-L20`).focus,
    ).toMatchObject({
      endLine: 20,
      line: 20,
    })
  })
})

describe('reserved pass-through', () => {
  // Two of these are read late — editorPerfLayout during every editor render, decode on
  // the first editor's idle callback — so a rewrite that dropped them would change
  // behaviour mid-session with no error and no log.
  test('copies the four dev params through encode -> decode -> encode unchanged', () => {
    const href = `/~${testWorkspaceToken('platform')}/workbench?decode=diffusion&editorPerfTrace=1&editorPerfDisable=x`
    const address = parseAddress(href)

    expect(address.passthrough).toEqual({
      decode: 'diffusion',
      editorPerfDisable: 'x',
      editorPerfTrace: '1',
    })
    expect(fixedPoint(href)).toContain('decode=diffusion')
    expect(fixedPoint(href)).toContain('editorPerfTrace=1')
    expect(fixedPoint(href)).toContain('editorPerfDisable=x')
  })

  test('keeps editorPerfLayout, which is read live during render', () => {
    expect(
      parseAddress(`/~${testWorkspaceToken('p')}/workbench?editorPerfLayout=transform`).passthrough,
    ).toEqual({
      editorPerfLayout: 'transform',
    })
  })

  test('does not mistake an owned key for a passthrough one', () => {
    expect(
      parseAddress(`/~${testWorkspaceToken('p')}/workbench?side=git&tabs=f/a.ts`).passthrough,
    ).toEqual({})
  })

  // An allow-list, not "everything unowned". Carrying unknown keys made any query param
  // permanent for the install: the projection copied it into every later address and
  // nothing could remove it, so a link could pin a stranger's flag on your machine.
  test('drops a param no one owns instead of adopting it forever', () => {
    const address = parseAddress(
      `/~${testWorkspaceToken('p')}/workbench?q=unowned&utm_source=newsletter&decode=diffusion`,
    )

    expect(address.passthrough).toEqual({ decode: 'diffusion' })
    expect(formatAddress(address)).toBe(`/~${testWorkspaceToken('p')}/workbench?decode=diffusion`)
  })
})

describe('owned search params', () => {
  test('reads the panel slots', () => {
    const address = parseAddress(
      `/~${testWorkspaceToken('p')}/workbench?side=git&bottom=terminal&tool=git&rail=archived`,
    )

    expect(address).toMatchObject({
      bottom: 'terminal',
      rail: 'archived',
      side: 'git',
      tool: 'git',
    })
  })

  test('drops a panel value outside its union', () => {
    expect(
      parseAddress(`/~${testWorkspaceToken('p')}/workbench?side=nope&bottom=nope`),
    ).toMatchObject({
      bottom: null,
      side: null,
    })
  })

  test('splits the tab set on `~`', () => {
    expect(
      parseAddress(`/~${testWorkspaceToken('p')}/workbench/f/a.ts?tabs=f/a.ts~f/b.ts~s`).tabs,
    ).toEqual(['f/a.ts', 'f/b.ts', 's'])
  })

  test('keeps the active editor token encoded independently from the chat session', () => {
    const href = `/~${testWorkspaceToken('p')}/chat/t/session-1?tabs=@~settings&editor=f/a%7Eb.ts`
    const address = parseAddress(href)

    expect(address.document).toBe('t/session-1')
    expect(address.editor).toBe('f/a%7Eb.ts')
    expect(address.tabs).toEqual(['f/a%7Eb.ts', 'settings'])
    expect(fixedPoint(href)).toBe(href)
  })

  // The rail scope is a ProjectId — a one-way hash of an absolute path — so it is not
  // addressable, and `diff` carries the session diff scope alone.
  test('keeps the session diff scope on its own key', () => {
    expect(parseAddress(`/~${testWorkspaceToken('p')}/chat/t/session-1?diff=turn-4a1b`).diff).toBe(
      'turn-4a1b',
    )
  })
})

describe('fixed point over hostile input', () => {
  // Equality with the INPUT, not merely stability: a codec that drops the document on
  // the first pass is perfectly stable from the second pass onward, so `not.toThrow()`
  // here passed against `formatAddress = () => '/'`.
  test('returns every canonical shape unchanged', () => {
    const hrefs = [
      '/',
      `/~${testWorkspaceToken('platform')}`,
      `/~${testWorkspaceToken('platform')}/chat`,
      `/~${testWorkspaceToken('platform')}/chat/t/session-9f3a1c2e?diff=wt`,
      `/~${testWorkspaceToken('platform')}/workbench/f/apps/web/src/main.tsx?side=git&bottom=problems#L21,9`,
      `/~${testWorkspaceToken('platform')}/workbench/s?decode=diffusion`,
      `/~${testWorkspaceToken('platform')}/workbench/f/a%20b/%C3%BCn%C3%AF.ts#L1`,
      `/~${testWorkspaceToken('platform')}/workbench/f/a%7Eb.ts`,
    ]

    for (const href of hrefs) expect(fixedPoint(href)).toBe(href)
  })

  // Three loops used to resolve duplicates by opposite rules: the named slots read
  // `params.get` (first), while the prefixed and passthrough groups overwrote (last).
  test('resolves a duplicated key the same way in every slot', () => {
    const address = parseAddress(
      `/~${testWorkspaceToken('p')}/workbench?side=git&side=files&s.q=one&s.q=two&decode=a&decode=b`,
    )

    expect(address.side).toBe('git')
    expect(address.search).toEqual({ q: 'one' })
    expect(address.passthrough).toEqual({ decode: 'a' })
  })

  // `#L(\d+)` cannot read `1e+21`, so emitting it lost the position on reload.
  test('omits a focus line the parser could not read back', () => {
    const href = formatAddress({
      ...emptyAddress(),
      focus: { column: null, endLine: null, line: 1e21 },
      workspace: testWorkspaceToken('p'),
    })

    expect(href).toBe(`/~${testWorkspaceToken('p')}`)
  })

  // Degrading means losing the field that is malformed, not the whole address.
  test('keeps the readable fields when a percent-escape is malformed', () => {
    const address = parseAddress(`/~${testWorkspaceToken('platform')}/workbench/f/a%.ts?side=git`)

    expect(address.workspace).toBe(testWorkspaceToken('platform'))
    expect(address.mode).toBe('workbench')
    expect(address.side).toBe('git')
  })

  test('escapes `~` in a slug so it cannot be read as a second segment marker', () => {
    const token = testWorkspaceToken('a~b')
    const href = formatAddress({ ...emptyAddress(), workspace: token })
    expect(href).toBe(`/~${token.replace('~', '%7E')}`)
    expect(parseAddress(href).workspace).toBe(token)
  })
})

describe('the settings category', () => {
  test('omits an empty category', () => {
    const href = formatAddress({
      ...emptyAddress(),
      settings: '',
      workspace: testWorkspaceToken('p'),
    })

    expect(href).toBe(`/~${testWorkspaceToken('p')}`)
    expect(parseAddress(href).settings).toBeNull()
    expect(fixedPoint(href)).toBe(href)
  })

  test('normalizes an empty category to absence', () => {
    expect(parseAddress(`/~${testWorkspaceToken('p')}`).settings).toBeNull()
    expect(parseAddress(`/~${testWorkspaceToken('p')}?settings=`).settings).toBeNull()
    expect(parseAddress(`/~${testWorkspaceToken('p')}?settings=providers`).settings).toBe(
      'providers',
    )
  })
})

describe('every owned field survives a round trip', () => {
  // The guard that was missing. `fixedPoint` only proves the string is STABLE, and a
  // serializer that drops a field is perfectly stable — it just drops it every time.
  // Five of the seven owned params were silently lost for exactly this reason.
  const FULL = {
    ...emptyAddress(),
    bottom: 'problems' as const,
    diff: 'turn-4a1b0c22',
    document: 'f/apps/web/src/main.tsx',
    focus: { column: 9, endLine: null, line: 21 },
    logs: { area: 'git', level: 'error' },
    mode: 'workbench' as const,
    passthrough: { decode: 'diffusion' },
    rail: 'archived' as const,
    search: { case: '1', q: 'createError' },
    settings: 'providers',
    side: 'git' as const,
    tabs: ['f/a.ts', 'f/b.ts', 's', 'f/apps/web/src/main.tsx'],
    tool: 'editor',
    workspace: testWorkspaceToken('platform'),
  }

  test('parses back to exactly what was serialized', () => {
    expect(parseAddress(formatAddress(FULL))).toEqual(FULL)
  })

  test('names every field in the emitted URL', () => {
    const href = formatAddress(FULL)

    for (const fragment of [
      `/~${testWorkspaceToken('platform')}/workbench/f/apps/web/src/main.tsx`,
      // `/` unescaped: legal in a query per RFC 3986, and `~` still separates.
      'tabs=f/a.ts~f/b.ts~s~@',
      'side=git',
      'bottom=problems',
      'tool=editor',
      'rail=archived',
      'diff=turn-4a1b0c22',
      'settings=providers',
      'log.level=error',
      's.q=createError',
      'decode=diffusion',
      '#L21,9',
    ]) {
      expect(href, `missing ${fragment}`).toContain(fragment)
    }
  })

  /**
   * The guard on reading `?tabs=` raw. `URLSearchParams.get` percent-decodes once, so
   * a token carrying an escaped separator comes back with a literal `~` and the split
   * finds a boundary that is not there — one tab silently becomes two. Anyone
   * "simplifying" the raw read back to `params.get` fails here.
   */
  test('keeps a file named with the tab separator as one tab', () => {
    const tabs = ['f/a%7Eb.ts', 'f/d%C3%BCr/x.ts']
    const href = formatAddress({ ...emptyAddress(), tabs, workspace: testWorkspaceToken('p') })

    expect(parseAddress(href).tabs).toEqual(tabs)
  })

  test('leaves the slash unescaped, and still round-trips', () => {
    const href = formatAddress({
      ...emptyAddress(),
      tabs: ['f/apps/web/src/main.tsx'],
      workspace: testWorkspaceToken('p'),
    })

    expect(href).toBe(`/~${testWorkspaceToken('p')}?tabs=f/apps/web/src/main.tsx`)
    expect(parseAddress(href).tabs).toEqual(['f/apps/web/src/main.tsx'])
  })

  // Field-by-field, so a failure names the field that broke rather than dumping a diff.
  test('round-trips each field independently', () => {
    const cases: [string, Partial<Address>][] = [
      ['tabs', { tabs: ['f/a.ts', 's'] }],
      ['editor', { editor: 'f/a%7Eb.ts' }],
      ['side', { side: 'git' }],
      ['bottom', { bottom: 'problems' }],
      ['tool', { tool: 'files' }],
      ['rail', { rail: 'archived' }],
      ['diff', { diff: 'wt' }],
      ['settings', { settings: 'models' }],
      ['logs', { logs: { level: 'warn' } }],
      ['search', { search: { q: 'x' } }],
      ['passthrough', { passthrough: { editorPerfTrace: '1' } }],
      ['focus', { focus: { column: null, endLine: 40, line: 12 } }],
    ]

    for (const [name, patch] of cases) {
      const address = {
        ...emptyAddress(),
        mode: 'workbench' as const,
        workspace: testWorkspaceToken('p'),
        ...patch,
      }
      expect(parseAddress(formatAddress(address)), `${name} did not survive`).toEqual(address)
    }
  })
})

describe('environment segment', () => {
  const primary =
    '2ba57809-12c4-44f7-8f4c-c8424cf4ac6c' as import('@workspace/contracts').EnvironmentId
  const remote =
    'cbdf3845-cc34-44f6-a097-840f38eac2b6' as import('@workspace/contracts').EnvironmentId
  const environments = { knownEnvironmentIds: [primary, remote], primaryEnvironmentId: primary }

  test('round-trips the confirmed remote identity before the workspace segment', () => {
    const href = `/@${remote}/~${testWorkspaceToken('/repo')}/chat/t/7c9ac8fb-14ad-4a20-8e54-d1756e4f9f97`
    const parsed = parseAddress(href, environments)
    expect(parsed).toMatchObject({
      environmentId: remote,
      rejectedEnvironment: null,
      workspace: testWorkspaceToken('/repo'),
      mode: 'chat',
    })
    expect(formatAddress(parsed, primary)).toBe(href)
  })

  test('omits primary identity and leaves unscoped addresses on primary', () => {
    const parsed = parseAddress(
      `/@${primary}/~${testWorkspaceToken('/repo')}/chat/t/new`,
      environments,
    )
    expect(parsed.environmentId).toBeNull()
    expect(formatAddress(parsed, primary)).toBe(`/~${testWorkspaceToken('/repo')}/chat/t/new`)
    expect(
      parseAddress(`/~${testWorkspaceToken('/repo')}/chat/t/new`, environments).environmentId,
    ).toBeNull()
  })

  test('preserves an unknown or malformed environment as a rejected token', () => {
    const unknown = '881e6a1b-b230-4e14-acdc-082db3f36e8e'
    for (const id of [unknown, 'bad-id', '']) {
      const href = `/@${id}/~${testWorkspaceToken('/repo')}/chat/t/7c9ac8fb-14ad-4a20-8e54-d1756e4f9f97`
      const parsed = parseAddress(href, environments)
      expect(parsed).toMatchObject({ environmentId: null, rejectedEnvironment: id })
      expect(formatAddress(parsed)).toBe(href)
    }
  })
})

describe('ordered tabs and explicit defaults', () => {
  const base = `/~${testWorkspaceToken('p')}/workbench`

  test('expands and compresses the selected editor in its ordered position', () => {
    const href = `${base}/f/b.ts?tabs=f/a.ts~@~f/c.ts`
    expect(parseAddress(href).tabs).toEqual(['f/a.ts', 'f/b.ts', 'f/c.ts'])
    expect(fixedPoint(href)).toBe(href)
    expect(fixedPoint(`${base}/f/b.ts?tabs=@`)).toBe(`${base}/f/b.ts?tabs=@`)
  })

  test('distinguishes unspecified and explicitly empty tabs', () => {
    expect(parseAddress(base).tabs).toBeNull()
    expect(parseAddress(`${base}?tabs=`).tabs).toBeNull()
    expect(parseAddress(`${base}?tabs=-`).tabs).toEqual([])
    expect(fixedPoint(`${base}?tabs=-`)).toBe(`${base}?tabs=-`)
  })

  test('rejects a contradictory or malformed collection without losing selection', () => {
    for (const tabs of ['-', '@~@', '-~f/a.ts', 'f/a.ts~~@', 'f/a.ts~nope', 'f/../a.ts']) {
      const address = parseAddress(`${base}/f/b.ts?tabs=${tabs}`)
      expect(address.tabs, tabs).toBeNull()
      expect(address.document).toBe('f/b.ts')
    }
    expect(parseAddress(`${base}?tabs=@`).tabs).toBeNull()
  })

  test('appends an omitted selected editor before enforcing the count limit', () => {
    expect(parseAddress(`${base}/f/b.ts?tabs=f/a.ts`).tabs).toEqual(['f/a.ts', 'f/b.ts'])
    const tabs = Array.from({ length: 64 }, (_, index) => `f/${index}`)
    expect(parseAddress(`${base}/f/b.ts?tabs=${tabs.join('~')}`).tabs).toBeNull()
  })

  test('keeps explicit defaults in incoming intent, then omits them on output', () => {
    const address = parseAddress(`${base}?side=files&bottom=terminal&tool=git&rail=active`)
    expect(address).toMatchObject({
      side: 'files',
      bottom: 'terminal',
      tool: 'git',
      rail: 'active',
    })
    expect(formatAddress(address)).toBe(base)
  })

  test('keeps percent signs, spaces, Unicode, at signs, tildes and encoded slashes intact', () => {
    const tabs = [
      'f/a%25.ts',
      'f/a%20b.ts',
      'f/%C3%BC.ts',
      'f/%40',
      'f/a%7Eb',
      'r/refs%2Fheads%2Fx/a.ts',
    ]
    const href = `${base}/f/%40?tabs=${tabs.slice(0, 3).join('~')}~@~${tabs.slice(4).join('~')}`
    expect(parseAddress(href).tabs).toEqual(tabs)
    expect(fixedPoint(href)).toBe(href)
  })

  test('opens a sidebar conversation unless an explicit different panel wins', () => {
    const session = 't/99dc0669-0262-4f92-a8d2-85ff6baea075'
    expect(parseAddress(`${base}?chat=${session}`)).toMatchObject({ side: 'chat', chat: session })
    expect(fixedPoint(`${base}?chat=${session}`)).toBe(`${base}?chat=${session}&side=chat`)
    expect(parseAddress(`${base}?chat=${session}&side=git`)).toMatchObject({
      side: 'git',
      chat: null,
    })
    expect(fixedPoint(`${base}?side=chat&chat=t/new`)).toBe(`${base}?chat=t/new&side=chat`)
    expect(parseAddress(`${base}?chat=t/bogus`).chat).toBeNull()
  })
})
