/** The connected windows that report being visible and focused. A closed socket stops counting. */
export class ClientPresence {
  private readonly focusedSockets = new Set<object>()

  report(socket: object, focused: boolean) {
    if (focused) {
      this.focusedSockets.add(socket)
      return
    }
    this.focusedSockets.delete(socket)
  }

  forget(socket: object) {
    this.focusedSockets.delete(socket)
  }

  get focusedCount() {
    return this.focusedSockets.size
  }
}
