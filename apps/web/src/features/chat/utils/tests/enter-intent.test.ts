import { composerEnterIntent, type SendShortcut } from '@/features/chat/utils/enter-intent'
import { expect, test } from '../../../../../test/fixtures'

function intents(sendShortcut: SendShortcut, prompt = 'one line') {
  const press = (shiftKey: boolean, modifierKey: boolean) =>
    composerEnterIntent({ modifierKey, prompt, sendShortcut, shiftKey })
  return {
    enter: press(false, false),
    mod: press(false, true),
    shift: press(true, false),
    shiftMod: press(true, true),
  }
}

test('enter: Enter sends, Shift+Enter adds a line, Ctrl/Cmd+Enter is the alternate send', () => {
  expect(intents('enter')).toEqual({
    enter: 'send',
    mod: 'alternate',
    shift: 'newline',
    shiftMod: 'newline',
  })
})

test('mod-enter: Enter adds a line, Ctrl/Cmd+Enter sends, Shift adds the alternate', () => {
  expect(intents('mod-enter')).toEqual({
    enter: 'newline',
    mod: 'send',
    shift: 'newline',
    shiftMod: 'alternate',
  })
})

test('mod-enter-multiline: like enter on one line, like mod-enter from the second line', () => {
  expect(intents('mod-enter-multiline')).toEqual(intents('enter'))
  expect(intents('mod-enter-multiline', 'first\nsecond')).toEqual(intents('mod-enter'))
})
