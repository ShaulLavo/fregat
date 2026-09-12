import { createTextDiff } from '@singapor/diff'
import {
  fnv1a32,
  stablePathHash,
  updateStableHashCode,
} from '@workspace/client-core/address/path-hash'
import { markdownHighlightCacheKey } from '@/features/chat/utils/markdown-highlight'
import { diffLanguageDocuments } from '@/features/editor/utils/diff-documents'
import { contentRevisionForText } from '@/features/editor/utils/text-snapshot'
import { shikiThemeContentHash } from '@/features/editor/utils/theme-content-hash'
import { searchResultItems } from '@/features/search/utils/result-items'
import { expect, test } from './fixtures'
import { searchResultGroup } from './factories/search-results'

test.each([
  ['', 'h:0:ztntfp', '811c9dc5', '2de5e154', 'dark:ts:0:ztntfp'],
  ['hello', 'h:5:m3bicr', '4f9f2cab', '028806c4', 'dark:ts:5:m3bicr'],
  ['a', 'h:1:1r9wi7g', 'e40c292c', '75e1866f', 'dark:ts:1:1r9wi7g'],
  ['雪😀', 'h:3:1w6cpmo', 'f5b662c0', '079c1fff', 'dark:ts:3:1w6cpmo'],
  ['\0', 'h:1:1efc4f', '050c5d1f', '94e1b73c', 'dark:ts:1:1efc4f'],
])(
  'keeps persisted revisions and each hash wrapper encoding for %j',
  (value, revision, pathHash, themeHash, highlightKey) => {
    expect(contentRevisionForText(value)).toBe(revision)
    expect(stablePathHash(value)).toBe(pathHash)
    expect(shikiThemeContentHash(value)).toBe(themeHash)
    expect(markdownHighlightCacheKey({ code: value, language: 'ts', themeKey: 'dark' })).toBe(
      highlightKey,
    )
  },
)

test('keeps the signed accumulator and supports continuing it one code unit at a time', () => {
  expect(fnv1a32('a')).toBe(-468965076)
  expect(fnv1a32('雪😀')).toBe(-172596544)
  expect(updateStableHashCode(fnv1a32('hell'), 'o'.charCodeAt(0))).toBe(fnv1a32('hello'))
})

test('keeps phantom diff filenames in unpadded base36', () => {
  const file = createTextDiff({
    newFile: { path: 'src/app.ts', text: 'hello' },
    oldFile: { path: 'src/app.ts', text: '\0' },
  })
  const documents = diffLanguageDocuments({
    documentPath: '/repo/src/app.ts',
    file,
    newSideIsWorkingTree: false,
    ownedText: null,
  })
  expect(documents.map((document) => document.uri)).toEqual([
    'file:///repo/src/app.__diff-new-m3bicr__.ts',
    'file:///repo/src/app.__diff-old-1efc4f__.ts',
  ])
})

test('keeps search location separators, missing fields, and duplicate suffixes in DOM ids', () => {
  const group = searchResultGroup()
  const duplicateGroup = { ...group, count: 2, matches: [...group.matches, ...group.matches] }
  expect(searchResultItems([duplicateGroup]).map((item) => item.id)).toEqual([
    'search-result-group-wffmwi',
    'search-result-match-wffmwi-1h6r4uw',
    'search-result-match-wffmwi-1h6r4uw-1',
  ])
  const nameGroup = searchResultGroup({
    count: 0,
    matches: [{ kind: 'name', source: 'disk', type: 'file', targetType: 'file', path: group.path }],
  })
  expect(searchResultItems([nameGroup]).map((item) => item.id)).toEqual([
    'search-result-name-wffmwi-th6ydm',
  ])
})
