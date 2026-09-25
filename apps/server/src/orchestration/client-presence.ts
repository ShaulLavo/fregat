const FOCUS_TTL_MS = 45_000

/** Focus expires when a suspended window stops refreshing its report. */
export class ClientPresence {
  private readonly focusedSockets = new Map<object, number>()

  report(socket: object, focused: boolean) {
    if (focused) {
      this.focusedSockets.set(socket, Date.now() + FOCUS_TTL_MS)
      return
    }
    this.focusedSockets.delete(socket)
  }

  forget(socket: object) {
    this.focusedSockets.delete(socket)
  }

  get focusedCount() {
    const now = Date.now()
    for (const [socket, expiresAt] of this.focusedSockets) {
      if (expiresAt <= now) this.focusedSockets.delete(socket)
    }
    return this.focusedSockets.size
  }
}
