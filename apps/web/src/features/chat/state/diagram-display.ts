import displayStyles from '@workspace/ui/foreign-svg.css?inline'

const sheets = new WeakMap<Document, CSSStyleSheet>()

export function mountDiagram(host: HTMLElement, svg: string) {
  const document = host.ownerDocument
  let sheet = sheets.get(document)
  if (!sheet) {
    sheet = new CSSStyleSheet()
    // The library's SVG stylesheet stays inside the root; only app tokens inherit.
    sheet.replaceSync(displayStyles)
    sheets.set(document, sheet)
  }
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [sheet]
  root.innerHTML = svg
}
