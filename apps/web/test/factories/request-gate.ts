export function createRequestGate(matches: (request: Request) => boolean) {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()

  return {
    beforeRequest(request: Request) {
      if (!matches(request)) return
      entered.resolve()
      return released.promise
    },
    entered: entered.promise,
    release: () => released.resolve(),
  }
}
