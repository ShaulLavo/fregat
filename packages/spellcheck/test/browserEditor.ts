import { assert } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor, type EditorPlugin } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'
import { EDITOR_SPELLCHECK_FEATURE, type EditorSpellcheckFeature } from '../src/feature'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofRowScreenshot: (hostId: string) => Promise<string>
    proofType: (text: string) => Promise<void>
  }
}

const mounted: { host: HTMLElement; editor: Editor }[] = []

export function disposeEditors(): void {
  for (const { host, editor } of mounted.splice(0)) {
    editor.dispose()
    host.remove()
  }
}

export function mountEditor(plugins: readonly EditorPlugin[]) {
  const host = document.createElement('div')
  host.id = `spell-${mounted.length}-${Date.now()}`
  host.style.cssText =
    'width:480px;height:160px;background:black;color:white;font:24px monospace;position:relative'
  host.style.setProperty('--editor-background', '#000000')
  host.style.setProperty('--editor-foreground', '#ffffff')
  document.body.append(host)
  const editor = new Editor(host, { plugins })
  mounted.push({ host, editor })
  const feature = () => editor.getFeature(EDITOR_SPELLCHECK_FEATURE) as EditorSpellcheckFeature
  return { host, editor, feature }
}

export async function rowPixels(hostId: string): Promise<ImageData> {
  const screenshot = await commands.proofRowScreenshot(hostId)
  const bytes = Uint8Array.from(atob(screenshot), (character) => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  assert(context)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export function ink(
  { data }: ImageData,
  matches: (red: number, green: number, blue: number) => boolean,
): number {
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (matches(data[index]!, data[index + 1]!, data[index + 2]!)) count++
  }
  return count
}

/** Either default of `spellcheck.misspelled` (#38bdf8 dark, #0284c7 light), with antialiasing slack. */
export function spellingInk(image: ImageData): number {
  return ink(image, (red, green, blue) => blue > 110 && blue > red + 60 && blue > green + 20)
}

export function redInk(image: ImageData): number {
  return ink(image, (red, green, blue) => red > 150 && green < 100 && blue < 100)
}

export async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for spellcheck')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
