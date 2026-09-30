function mark(kind: string) {
  performance.mark(`fregat:style-write:${kind}`)
}

function observeStyles(root: Node, kind: string) {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target.nodeName === 'STYLE' || record.target.parentNode?.nodeName === 'STYLE') {
        mark(kind)
        continue
      }
      if ([...record.addedNodes, ...record.removedNodes].some((node) => node.nodeName === 'STYLE'))
        mark(kind)
    }
  })
  observer.observe(root, { childList: true, characterData: true, subtree: true })
}

function observeAdoption(prototype: typeof Document.prototype | typeof ShadowRoot.prototype) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'adoptedStyleSheets')
  const original = descriptor?.set
  if (!original) return
  Object.defineProperty(prototype, 'adoptedStyleSheets', {
    ...descriptor,
    set(this: Document | ShadowRoot, sheets: CSSStyleSheet[]) {
      original.call(this, sheets)
      mark('adopted')
    },
  })
}

observeAdoption(Document.prototype)
observeAdoption(ShadowRoot.prototype)
const attachShadow = Element.prototype.attachShadow
Element.prototype.attachShadow = function (options) {
  const root = attachShadow.call(this, options)
  observeStyles(root, 'shadow')
  return root
}

const replaceSync = CSSStyleSheet.prototype.replaceSync
CSSStyleSheet.prototype.replaceSync = function (text) {
  replaceSync.call(this, text)
  mark('sheet')
}

document.addEventListener('DOMContentLoaded', () => observeStyles(document.head, 'head'), {
  once: true,
})
