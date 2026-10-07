import { expect, test } from '../../../../../test/fixtures'
import { resolveTranscriptCommit, type VoiceDraftSnapshot } from '../voice-draft'

const draft: VoiceDraftSnapshot = {
  ownerKey: 'composer',
  text: 'Hello world',
  selection: { start: 6, end: 11 },
  revision: 0,
}

test('dictation replaces selected text and puts the caret after it', () => {
  expect(resolveTranscriptCommit(draft, draft, ' friend ', 'en-US')).toEqual({
    kind: 'commit',
    text: 'Hello friend',
    selection: { start: 12, end: 12 },
  })
})
test('English dictation at the end adds a word boundary', () => {
  const end = { ...draft, selection: { start: 11, end: 11 } }
  expect(resolveTranscriptCommit(end, end, 'again', 'en-US')).toMatchObject({
    text: 'Hello world again',
  })
})
test('the upstream spacing rule respects the transcription locale', () => {
  const end = { ...draft, text: '你好', selection: { start: 2, end: 2 } }
  expect(resolveTranscriptCommit(end, end, '世界', 'zh-CN')).toMatchObject({ text: '你好世界' })
})
test('changed owners and revisions reject the transcript, including a restored original text', () => {
  expect(
    resolveTranscriptCommit(draft, { ...draft, ownerKey: 'other' }, 'speech', 'en-US'),
  ).toEqual({ kind: 'stale' })
  expect(resolveTranscriptCommit(draft, { ...draft, revision: 2 }, 'speech', 'en-US')).toEqual({
    kind: 'stale',
  })
  expect(resolveTranscriptCommit(draft, null, 'speech', 'en-US')).toEqual({ kind: 'stale' })
})
test('empty speech leaves the draft alone', () => {
  expect(resolveTranscriptCommit(draft, draft, '  ', 'en-US')).toEqual({ kind: 'empty' })
})
