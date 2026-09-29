export function elementBoundaryToTextOffset(offset: number, textLength: number): number {
  if (offset <= 0) return 0
  return textLength
}

export function childContainingNode(ancestor: Node, node: Node): ChildNode | null {
  for (const child of ancestor.childNodes) {
    if (child === node || child.contains(node)) return child
  }

  return null
}

export function childNodeIndex(parent: Node, child: ChildNode): number {
  return Array.prototype.indexOf.call(parent.childNodes, child) as number
}
