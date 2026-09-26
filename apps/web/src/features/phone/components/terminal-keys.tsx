import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  type Icon,
} from '@phosphor-icons/react'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { useEffect, useState, type RefObject } from 'react'

import { KeyButton } from '@/features/phone/components/key-button'
import {
  controlKeyFor,
  TERMINAL_KEYS,
  type TerminalKey,
} from '@/features/phone/utils/terminal-keys'

const ARROWS: readonly (readonly [TerminalKey, Icon])[] = [
  [TERMINAL_KEYS.left, ArrowLeftIcon],
  [TERMINAL_KEYS.up, ArrowUpIcon],
  [TERMINAL_KEYS.down, ArrowDownIcon],
  [TERMINAL_KEYS.right, ArrowRightIcon],
]

/**
 * The keys a touch keyboard lacks. Each press reaches the terminal as the keydown a hardware
 * keyboard sends, so the terminal encodes it for the running program's modes. Ctrl holds until
 * the next letter typed. Presses keep focus in the terminal, so the keyboard stays up.
 */
export function TerminalKeys({
  terminalRef,
}: {
  readonly terminalRef: RefObject<HTMLElement | null>
}) {
  const [control, setControl] = useState(false)

  useEffect(() => {
    const host = terminalRef.current
    if (!host || !control) return
    const onBeforeInput = (event: InputEvent) => {
      const chord = event.data ? controlKeyFor(event.data) : null
      // A composing keyboard (Android's) sends an input that cannot be cancelled; it stays text.
      if (!chord || !event.cancelable) return
      event.preventDefault()
      setControl(false)
      press(host, chord, true)
    }
    host.addEventListener('beforeinput', onBeforeInput, { capture: true })
    return () => host.removeEventListener('beforeinput', onBeforeInput, { capture: true })
  }, [control, terminalRef])

  function send(key: TerminalKey) {
    const host = terminalRef.current
    if (!host) return
    press(host, key, control)
    setControl(false)
  }

  return (
    <PaneBar aria-label='Terminal keys' role='toolbar'>
      <KeyButton label='Esc' onPress={() => send(TERMINAL_KEYS.escape)} />
      <KeyButton label='Tab' onPress={() => send(TERMINAL_KEYS.tab)} />
      <KeyButton label='Ctrl' pressed={control} onPress={() => setControl((held) => !held)} />
      <span className='ml-auto flex shrink-0 items-center gap-(--density-gap-tight)'>
        {ARROWS.map(([key, Glyph]) => (
          <KeyButton icon={Glyph} key={key.id} label={key.label} onPress={() => send(key)} />
        ))}
      </span>
    </PaneBar>
  )
}

/** Sends a key to the terminal's input, the one element that reads the keyboard. */
function press(host: HTMLElement, key: TerminalKey, ctrlKey: boolean) {
  const input = host.querySelector('textarea')
  if (!input) return
  const init = { bubbles: true, cancelable: true, code: key.code, ctrlKey, key: key.key }
  input.dispatchEvent(new KeyboardEvent('keydown', init))
  input.dispatchEvent(new KeyboardEvent('keyup', init))
}
