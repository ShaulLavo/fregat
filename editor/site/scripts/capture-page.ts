import { decodePaintSnapshot, mountPaintSnapshot } from '@singapore-editor/core/paint'
import { mountDocsEditor } from '../src/manual/editor'
import { documentOptions } from '../src/manual/configuration'
import { fenceLanguage } from '../src/manual/languages'
import { Kind } from 'tree-sitter-md'
import '../src/styles/manual.css'

Object.assign(window, {
  async capture(file: string, text: string, theme: 'light' | 'dark') {
    document.documentElement.dataset.theme = theme
    const host = document.getElementById('capture')!
    host.style.width = '752px'
    await document.fonts.load('14px "JetBrains Mono"')
    await document.fonts.ready
    const options = { ...documentOptions(host, file, text), openLink() {} }
    const docs = mountDocsEditor(host, options)
    try {
      docs.editor.setSelection(text.length, text.length, { reveal: false })
      if (file.endsWith('.md')) {
        await docs.ready()
        validateFences(file, text, docs.editor.getSyntaxRecords()!.data)
      } else await docs.highlighted()
      docs.editor.setPresentationReady(true)
      await frame()
      await frame()
      for (const width of [312, 382, 752]) {
        host.style.width = `${width}px`
        await frame()
        await frame()
        await qualify('live', width)
      }
      const saved = docs.editor.captureSnapshot({ scope: 'document' })
      if (saved.status !== 'ready') throw new TypeError(`${file}: ${saved.reason}`)
      const paint = decodePaintSnapshot(saved.paint)
      if (!paint || paint.format !== 6) throw new TypeError(`${file}: invalid document paint`)
      const height = docs.element.getBoundingClientRect().height
      docs.dispose()
      const restored = mountDocsEditor(host, { ...options, snapshot: saved.paint })
      try {
        if (restored.editor.getPresentationState() !== 'provisional')
          throw new TypeError(`${file}: restored document paint was refused`)
        await qualify('provisional', 752)
        restored.editor.setSelection(text.length, text.length, { reveal: false })
        restored.editor.setPresentationReady(true)
        if (file.endsWith('.md')) await restored.ready()
        else await restored.highlighted()
        for (const width of [312, 382, 752]) {
          host.style.width = `${width}px`
          await frame()
          await frame()
          await qualify('restored', width)
        }
        const recapture = restored.editor.captureSnapshot({ scope: 'document' })
        if (recapture.status !== 'ready')
          throw new TypeError(`${file}: restore ${recapture.reason}`)
        if (Math.abs(restored.element.getBoundingClientRect().height - height) > 0.5)
          throw new TypeError(`${file}: restore height changed`)
      } finally {
        restored.dispose()
      }
      const html: Record<number, string> = {}
      const anchors: Record<number, Record<string, number>> = {}
      let rows = 0
      for (const width of [312, 382, 752]) {
        host.style.width = `${width}px`
        const mounted = mountPaintSnapshot(host, paint)
        if (!mounted) throw new TypeError(`${file}: paint mount refused at ${width}`)
        try {
          await qualify('emitted', width)
          const top = mounted.element.getBoundingClientRect().top
          anchors[width] = {}
          for (const heading of mounted.element.querySelectorAll<HTMLElement>('[id]')) {
            anchors[width][heading.id] = heading.getBoundingClientRect().top - top
            heading.removeAttribute('id')
          }
          html[width] = mounted.element.outerHTML
          rows = mounted.rowCount
        } finally {
          mounted.dispose()
        }
      }
      const headings = paint.rows.flatMap((row) => (row.heading ? [row.heading] : []))
      const description =
        paint.rows
          .find((row) => !row.heading && row.runs.some((run) => run.text.trim()))
          ?.runs.filter((run) => run.style.visibility !== 'hidden')
          .map((run) => run.text)
          .join('') ?? ''
      return {
        paint: saved.paint,
        html,
        anchors,
        headings,
        description,
        height,
        rows,
      }
    } finally {
      docs.dispose()
      host.replaceChildren()
    }
  },
})
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function qualify(stage: string, width: number) {
  await (
    window as unknown as { qualifyCapture(stage: string, width: number): Promise<void> }
  ).qualifyCapture(stage, width)
}

function validateFences(file: string, text: string, records: ArrayLike<number>) {
  for (let index = 0; index < records.length; index += 4) {
    if (records[index + 2] !== Kind.CodeBlock) continue
    const start = records[index]!
    const end = text.indexOf('\n', start)
    const line = text.slice(start, end === -1 ? text.length : end)
    const info = line.match(/^\s*(?:`{3,}|~{3,})(.*)$/)?.[1]
    if (info !== undefined && fenceLanguage(info) === null)
      throw new TypeError(`${file}: no grammar for fence language "${info}"`)
  }
}
