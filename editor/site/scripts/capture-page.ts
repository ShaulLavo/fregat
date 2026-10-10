import { decodePaintSnapshot, mountPaintSnapshot } from '@singapore-editor/core/paint'
import { mountExample } from '../src/manual/example-editor'
import '../src/manual/example-styles'
import '../src/styles/manual.css'
import '../src/styles/examples.css'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
Object.assign(window, {
  async capture(text: string, language: string, theme: 'light' | 'dark') {
    document.documentElement.dataset.theme = theme
    const host = document.getElementById('capture')!
    host.style.width = '752px'
    await document.fonts.load('14px "JetBrains Mono"')
    await document.fonts.ready
    const example = mountExample(host, { text, language, label: 'Build-time example' })
    try {
      await example.ready()
      const saved = example.editor.captureSnapshot({ scope: 'document' })
      if (saved.status !== 'ready') throw new TypeError(`Example capture: ${saved.reason}`)
      const paint = decodePaintSnapshot(saved.paint)
      if (!paint || paint.format !== 6) throw new TypeError('Invalid example paint')
      example.dispose()
      const html: Record<number, string> = {}
      for (const width of [240, 288, 358, 480, 600, 704, 752]) {
        host.style.width = `${width}px`
        const mounted = mountPaintSnapshot(host, paint)
        if (!mounted) throw new TypeError(`Example paint refused at ${width}`)
        await frame()
        // Captured colour spans paint before scripts and avoid hidden-root Highlight invalidation.
        for (const row of mounted.element.querySelectorAll<HTMLElement>(
          '[data-editor-document-paint-row]',
        )) {
          const index = Number(row.dataset.editorDocumentPaintSourceRow)
          const start = Number(row.dataset.editorDocumentPaintStart)
          const end = start + row.textContent!.length
          let offset = 0
          const fragments: HTMLElement[] = []
          for (const run of paint.rows[index]!.runs) {
            const stop = offset + run.text.length
            if (stop > start && offset < end) {
              const span = document.createElement('span')
              span.textContent = run.text.slice(Math.max(0, start - offset), end - offset)
              span.style.color = run.style.color
              span.style.textDecoration = run.style.textDecoration
              fragments.push(span)
            }
            offset = stop
          }
          row.replaceChildren(...fragments)
        }
        html[width] = mounted.element.outerHTML
        mounted.dispose()
      }
      return { paint: saved.paint, html }
    } finally {
      example.dispose()
      host.replaceChildren()
    }
  },
})
