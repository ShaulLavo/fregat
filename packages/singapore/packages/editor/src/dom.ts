export function isElementNode(node: Node): node is Element {
  return node.nodeType === 1
}

export function isHtmlElement(node: Node): node is HTMLElement {
  return isElementNode(node) && node.namespaceURI === 'http://www.w3.org/1999/xhtml'
}

export function isTextareaElement(element: HTMLElement): element is HTMLTextAreaElement {
  return element.localName === 'textarea'
}
