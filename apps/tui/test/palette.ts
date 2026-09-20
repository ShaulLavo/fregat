import { act } from 'react'

import type { renderTui } from './render'

export async function openPaletteSearch(
  frame: Awaited<ReturnType<typeof renderTui>>,
  query: string,
) {
  await enterPaletteQuery(frame, query, false)
  await frame.renderOnce()
}

export async function submitPaletteSearch(
  frame: Awaited<ReturnType<typeof renderTui>>,
  query: string,
) {
  await enterPaletteQuery(frame, query, true)
}

async function enterPaletteQuery(
  frame: Awaited<ReturnType<typeof renderTui>>,
  query: string,
  submit: boolean,
) {
  await act(async () => {
    frame.mockInput.pressKey('F1')
  })
  await act(async () => {
    frame.mockInput.pressKey('END')
    frame.mockInput.pressKey('BACKSPACE')
    await frame.mockInput.typeText(query)
    if (submit) frame.mockInput.pressEnter()
  })
}
