export function createTraceBuffer<T>(capacity: number) {
  const items: T[] = []
  let cursor = 0
  let dropped = 0
  return {
    push(item: T) {
      if (items.length < capacity) {
        items.push(item)
        return
      }
      dropped += 1
      items[cursor] = item
      cursor = (cursor + 1) % capacity
    },
    values(): T[] {
      return items.slice(cursor).concat(items.slice(0, cursor))
    },
    droppedCount(): number {
      return dropped
    },
    clear() {
      items.length = 0
      cursor = 0
      dropped = 0
    },
  }
}
