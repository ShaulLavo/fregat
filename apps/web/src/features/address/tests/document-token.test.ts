import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { DOCUMENT_TARGET_CASES, testTabContent } from '../../../../test/factories/document-targets'
import { TEST_SESSION_ID } from '../../../../test/factories/chat'
import {
  contentForDocumentToken,
  documentTokenForContent,
} from '@/features/address/utils/document-token'
import {
  fileDocument,
  fileResource,
  filesystemPath,
  workspaceRoot,
} from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import type { TabContent } from '@/lib/documents/utils/types'
import { emptyAddress, formatAddress, parseAddress } from '@workspace/client-core/address/grammar'

const ROOT = '/repo'
const OLD_OID = 'a'.repeat(40)
const NEW_OID = 'b'.repeat(40)

test.each(DOCUMENT_TARGET_CASES)(
  'preserves the full URL route for $kind',
  ({ rootPath, path, token }) => {
    const content = testTabContent(path, rootPath)
    const result = documentTokenForContent(rootPath, content)
    if (token === null) {
      expect(result.kind).toBe('unaddressable')
      return
    }
    expect(result).toEqual({ kind: 'token', token })
    expect(throughUrl(rootPath, content)).toEqual(content)
  },
)

test.each(['settings-json:user', 'git-diff:%%%'])(
  'round-trips explicit file %s without interpreting its name as a document identity',
  (name) => {
    const content = documentTab(fileDocument(fileResource(filesystemPath(name))))
    expect(documentTokenForContent('', content)).toEqual({
      kind: 'token',
      token: `f/${encodeURIComponent(name)}`,
    })
    expect(throughUrl('', content)).toEqual(content)
  },
)

test('refuses a search view owned by another workspace', () => {
  expect(
    documentTokenForContent(ROOT, documentTab({ kind: 'search', root: workspaceRoot('/other') }))
      .kind,
  ).toBe('unaddressable')
})

test('refuses a checkpoint view owned by another workspace', () => {
  const content = documentTab({
    kind: 'git-diff',
    source: {
      kind: 'checkpoint-session',
      owner: workspaceRoot('/other'),
      sessionId: TEST_SESSION_ID,
      fromTurnCount: 0,
      toTurnCount: 2,
    },
  })
  expect(documentTokenForContent(ROOT, content).kind).toBe('unaddressable')
})

test('refuses files outside the workspace and documents without a workspace', () => {
  expect(documentTokenForContent(ROOT, testTabContent('/elsewhere/a.ts')).kind).toBe(
    'unaddressable',
  )
  expect(documentTokenForContent(null, testTabContent('/repo/a.ts')).kind).toBe('unaddressable')
  expect(documentTokenForContent(null, { kind: 'settings' })).toEqual({
    kind: 'token',
    token: 'settings',
  })
})

describe('snapshot metadata', () => {
  test.each(['deleted', 'untracked', 'modified', 'renamed'] as const)(
    'round-trips %s status and revision identities',
    (status) => {
      const content = documentTab({
        kind: 'git-diff',
        source: {
          kind: 'snapshot',
          path: filesystemPath('/repo/src/a.ts'),
          source: 'worktree',
          oldObjectId: status === 'untracked' ? undefined : OLD_OID,
          newObjectId: status === 'deleted' ? undefined : NEW_OID,
          oldPath: status === 'renamed' ? filesystemPath('/repo/src/old name.ts') : undefined,
          status,
        },
      })
      expect(throughUrl(ROOT, content)).toEqual(content)
    },
  )

  test('accepts SHA-256 object ids', () => {
    const oid = 'c'.repeat(64)
    expect(contentForDocumentToken(ROOT, `d/worktree/${oid}..${oid}/a.ts`).kind).toBe('content')
  })

  test.each(['d/worktree/_.._/a.ts', 'd/worktree/zzz..zzz/a.ts', 'd/bogus/a..b/a.ts'])(
    'rejects unusable revision %s',
    (token) => {
      expect(contentForDocumentToken(ROOT, token).kind).toBe('rejected')
    },
  )

  test('reports branch diffs as unavailable', () => {
    expect(contentForDocumentToken(ROOT, `d/branch/${OLD_OID}..${NEW_OID}/src/a.ts`).kind).toBe(
      'unavailable',
    )
  })
})

describe('untrusted URL input', () => {
  test.each(['a b.ts', 'ünïcödé.ts', 'a#b.ts', 'a?b.ts', 'a%20b.ts', 'a~b!c.ts'])(
    'round-trips filename %s through the whole URL',
    (name) => {
      const content = testTabContent(`${ROOT}/${name}`)
      expect(throughUrl(ROOT, content)).toEqual(content)
    },
  )

  test('escapes separators within a filename', () => {
    expect(documentTokenForContent(ROOT, testTabContent('/repo/a~b!c.ts'))).toEqual({
      kind: 'token',
      token: 'f/a%7Eb%21c.ts',
    })
  })

  test.each(['f/a%E0%A4%A', 'f/../../etc/passwd', 'zzz/a.ts', '', 'k/not-a-session/1..2/src/a.ts'])(
    'rejects %s',
    (token) => {
      expect(() => contentForDocumentToken(ROOT, token)).not.toThrow()
      expect(contentForDocumentToken(ROOT, token).kind).toBe('rejected')
    },
  )

  test('rejects a backwards turn range', () => {
    expect(contentForDocumentToken(ROOT, `k/${TEST_SESSION_ID}/9..2`).kind).toBe('rejected')
  })

  test('does not promote arbitrary revision or status strings into checkpoint metadata', () => {
    expect(
      contentForDocumentToken(ROOT, `k/${TEST_SESSION_ID}/1..2,s=notastatus,o=nothex/src/a.ts`),
    ).toMatchObject({
      kind: 'content',
      content: {
        kind: 'document',
        document: {
          kind: 'git-diff',
          source: {
            kind: 'checkpoint-file',
            oldObjectId: undefined,
            status: undefined,
          },
        },
      },
    })
  })
})

function throughUrl(rootPath: string, content: TabContent): TabContent {
  const encoded = documentTokenForContent(rootPath, content)
  if (encoded.kind !== 'token') return expect.unreachable(`Expected token, got ${encoded.kind}`)
  const address = formatAddress({
    ...emptyAddress(),
    document: encoded.token,
    mode: 'workbench',
    workspace: testWorkspaceToken(rootPath),
  })
  const parsed = contentForDocumentToken(rootPath, parseAddress(address).document ?? '')
  if (parsed.kind !== 'content') return expect.unreachable(`Expected content, got ${parsed.kind}`)
  return parsed.content
}
