import { act } from 'react'
import type { renderTui } from './render'

type PaletteFrame = Pick<Awaited<ReturnType<typeof renderTui>>, 'mockInput'>

export async function runPaletteCommand(
  frame: PaletteFrame,
  title: string,
  settle?: () => Promise<void>,
) {
  await act(async () => {
    frame.mockInput.pressKey('F1')
  })
  await act(async () => {
    await frame.mockInput.typeText(title)
  })
  await act(async () => {
    frame.mockInput.pressEnter()
  })
  if (settle) await act(settle)
}
