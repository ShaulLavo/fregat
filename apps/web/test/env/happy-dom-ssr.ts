import type { Environment } from 'vitest/runtime'
import { builtinEnvironments } from 'vitest/runtime'

const happyDomEnvironment = builtinEnvironments['happy-dom']

const happyDomSsrEnvironment: Environment = {
  ...happyDomEnvironment,
  name: 'happy-dom-ssr',
  async setup(global, options) {
    const environment = await happyDomEnvironment.setup(global, options)
    configureStandardsDocument(global.document)
    // Happy DOM canvas objects cannot cross the native Worker's transfer boundary.
    Object.defineProperty(global, 'OffscreenCanvas', {
      configurable: true,
      value: undefined,
      writable: true,
    })

    return environment
  },
  viteEnvironment: 'ssr',
}

export default happyDomSsrEnvironment

function configureStandardsDocument(document: Document) {
  if (!document.doctype) {
    const doctype = document.implementation.createDocumentType('html', '', '')
    document.insertBefore(doctype, document.documentElement)
  }

  // Happy DOM leaves this undefined even when a doctype exists. Browser code
  // such as KaTeX correctly interprets any value except CSS1Compat as quirks.
  Object.defineProperty(document, 'compatMode', {
    configurable: true,
    value: 'CSS1Compat',
  })
  makeSelectionChangeAsynchronous(document)
}

function makeSelectionChangeAsynchronous(document: Document) {
  const dispatchEvent = document.dispatchEvent.bind(document)
  let selectionChangeQueued = false

  // Browsers queue selectionchange; Happy DOM dispatches it synchronously.
  // The synchronous re-entry catches Lexical while its selection is read-only.
  document.dispatchEvent = (event) => {
    if (event.type !== 'selectionchange') return dispatchEvent(event)
    if (selectionChangeQueued) return true

    selectionChangeQueued = true
    queueMicrotask(() => {
      dispatchEvent(event)
      selectionChangeQueued = false
    })
    return true
  }
}
