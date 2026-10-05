import { expect, test } from './fixtures'
import { fileDocumentKey, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { groupId } from '@/lib/documents/utils/group-types'
import { retentionAcceptanceReloadFrameOutcome } from './factories/retention-acceptance-reload-frame'

type ReloadInput = Parameters<typeof retentionAcceptanceReloadFrameOutcome>[0]
type ReloadView = Extract<
  NonNullable<ReloadInput['frame']['observation']>,
  { kind: 'mounted' }
>['views'][number]
type ReloadBinding = Extract<ReloadView, { binding: unknown }>['binding']

const path = filesystemPath('repo/src/editor-tab-a.ts')
const binding = {
  selectedTabId: tabId('reload-control'),
  viewDocumentKey: null,
  controllerRegistered: false,
  nativePresentation: null,
  nativeInitialHighlightStatus: null,
  snapshot: null,
  canonical: null,
} as const
const view = {
  kind: 'unready',
  groupId: groupId('reload-control-group'),
  path,
  headerPath: path,
  binding,
} as const
const emptyRow = {
  text: '',
  html: '<div class="editor-virtualized-row"></div>',
  visible: true,
  runs: [],
} as const
const frame = {
  at: 0,
  editor: true,
  rows: [emptyRow],
  fonts: { status: 'loaded', codeLoaded: true },
  input: { mounted: true, readonly: true, disabled: false },
  header: {
    tabId: binding.selectedTabId,
    groupId: view.groupId,
    path,
    busy: true,
    loading: true,
  },
  observation: { kind: 'mounted', views: [view] },
} satisfies ReloadInput['frame']
const input = {
  frame,
  settledReference: {
    identity: {
      document: fileDocumentKey(path),
      revision: 0,
      configuration: 'unknown',
      paintedGeneration: 'unknown',
    },
    source: "export const editorTabA = 'real browser fixture A'\n",
    runs: [],
    expected: 'plain',
  },
  expectedPath: path,
  syntax: 'plain',
  admission: 'unbound',
} satisfies ReloadInput

test('admits the paired readonly loading mount before source binding', () => {
  expect(retentionAcceptanceReloadFrameOutcome(input).kind).toBe('prebinding')
  expect(
    retentionAcceptanceReloadFrameOutcome({ ...input, frame: { ...frame, rows: [] } }).kind,
  ).toBe('prebinding')
})

test.each(['source', 'current'] as const)(
  'rejects an empty mount after %s admission',
  (admission) => {
    expect(retentionAcceptanceReloadFrameOutcome({ ...input, admission }).kind).toBe('mismatch')
    expect(
      retentionAcceptanceReloadFrameOutcome({ ...input, admission, frame: { ...frame, rows: [] } })
        .kind,
    ).toBe('mismatch')
    expect(
      retentionAcceptanceReloadFrameOutcome({
        ...input,
        admission,
        frame: { ...frame, editor: false, rows: [], input: { ...frame.input, mounted: false } },
      }).kind,
    ).toBe('mismatch')
  },
)

test.each([
  { ...binding, viewDocumentKey: fileDocumentKey(path) },
  { ...binding, controllerRegistered: true },
  { ...binding, nativePresentation: 'live' },
  { ...binding, nativeInitialHighlightStatus: 'loading' },
  {
    ...binding,
    snapshot: {
      documentId: fileDocumentKey(path),
      revision: 0,
      syntaxStatus: 'loading',
      initialHighlightStatus: 'loading',
      paintLayersAvailable: false,
    },
  },
  {
    ...binding,
    canonical: {
      documentId: fileDocumentKey(path),
      revision: 0,
      source: input.settledReference.source,
    },
  },
] satisfies ReloadBinding[])('rejects partial binding evidence %#', (partial) => {
  const observation = {
    kind: 'mounted',
    views: [{ ...view, binding: partial }],
  } satisfies NonNullable<ReloadInput['frame']['observation']>
  expect(
    retentionAcceptanceReloadFrameOutcome({ ...input, frame: { ...frame, observation } }).kind,
  ).toBe('mismatch')
  expect(
    retentionAcceptanceReloadFrameOutcome({
      ...input,
      frame: {
        ...frame,
        editor: false,
        rows: [],
        input: { ...frame.input, mounted: false },
        observation,
      },
    }).kind,
  ).toBe('mismatch')
})

test.each([
  { ...frame, header: { ...frame.header, busy: false } },
  { ...frame, header: { ...frame.header, loading: false } },
  { ...frame, header: { ...frame.header, tabId: 'other-tab' } },
  { ...frame, header: { ...frame.header, groupId: 'other-group' } },
  { ...frame, header: { ...frame.header, path: 'repo/src/other.ts' } },
  { ...frame, input: { ...frame.input, readonly: false } },
  { ...frame, input: { ...frame.input, disabled: true } },
  { ...frame, input: { ...frame.input, mounted: false } },
  { ...frame, rows: [{ ...emptyRow, text: 'stale source' }] },
  { ...frame, rows: [{ ...emptyRow, html: '<div data-editor-provisional-row></div>' }] },
  { ...frame, rows: [...frame.rows, ...frame.rows] },
  { ...frame, observation: null },
  { ...frame, observation: { kind: 'mounted', views: [] } },
  { ...frame, observation: { kind: 'mounted', views: [view, view] } },
  {
    ...frame,
    observation: { kind: 'mounted', views: [{ ...view, headerPath: filesystemPath('other') }] },
  },
] satisfies ReloadInput['frame'][])('rejects an unqualified prebinding mount %#', (invalid) => {
  expect(retentionAcceptanceReloadFrameOutcome({ ...input, frame: invalid }).kind).toBe('mismatch')
})
