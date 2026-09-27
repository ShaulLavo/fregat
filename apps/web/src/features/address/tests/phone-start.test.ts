import { expect, test } from '../../../../test/fixtures'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { phoneBaseScreen, phoneStartAddress } from '@/features/address/utils/phone-start'

const session = '/~repo/chat/t/11111111-1111-4111-8111-111111111111'

test('preloads the main session or list independently of a sidebar conversation', () => {
  expect(phoneBaseScreen('/~repo/chat')).toBe('sessions')
  expect(phoneBaseScreen(session)).toBe('session')
  expect(phoneBaseScreen('/~repo/chat/t/new')).toBe('session')
  expect(phoneBaseScreen(`${session}?screen=file`)).toBe('session')
  expect(phoneBaseScreen('/~repo/workbench?side=chat&chat=t/new')).toBe('sessions')
})

test('a touch phone opening the bare URL restores its workspace at the sessions list', () => {
  const href = phoneStartAddress(`${session}?screen=file&editor=f/notes.md`, '/', true)
  expect(parseAddress(href)).toMatchObject({
    workspace: 'repo',
    mode: 'chat',
    document: null,
    editor: 'f/notes.md',
    screen: null,
  })
  expect(phoneBaseScreen(href)).toBe('sessions')
})

test('direct links and narrow desktop restoration keep their session and pushed screen', () => {
  const href = `${session}?screen=terminal`
  expect(phoneStartAddress(href, href, true)).toBe(href)
  expect(phoneStartAddress(href, '/', false)).toBe(href)
})

test('a phone keeps the restored desktop document available while starting at the list', () => {
  const href = phoneStartAddress('/~repo/workbench/f/notes.md?tabs=@~f/other.md', '/', true)
  expect(parseAddress(href)).toMatchObject({
    mode: 'chat',
    document: null,
    editor: 'f/notes.md',
    tabs: ['f/notes.md', 'f/other.md'],
  })
})
