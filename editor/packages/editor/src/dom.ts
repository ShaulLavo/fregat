export function isTextareaElement(element: HTMLElement): element is HTMLTextAreaElement {
  return element.localName === 'textarea'
}
