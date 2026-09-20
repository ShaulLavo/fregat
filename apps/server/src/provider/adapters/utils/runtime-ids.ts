export function runtimeEventId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`
}

export function noop() {}
