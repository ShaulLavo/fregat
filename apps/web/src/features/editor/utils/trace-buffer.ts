export function createTraceBuffer<T>(capacity: number) {
  const items: T[] = []
  let cursor = 0
  return {
    push(item: T) {
      if (items.length < capacity) {
        items.push(item)
        return
      }
      items[cursor] = item
      cursor = (cursor + 1) % capacity
    },
    values(): T[] {
      return items.slice(cursor).concat(items.slice(0, cursor))
    },
    clear() {
      items.length = 0
      cursor = 0
    },
  }
}
