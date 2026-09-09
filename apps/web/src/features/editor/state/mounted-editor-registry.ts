export class MountedEditorRegistry {
  private readonly counts = new Map<string, number>()
  private readonly emittedMounted = new Set<string>()
  private readonly listeners = new Set<(path: string, mounted: boolean) => void>()
  private readonly transitionGeneration = new Map<string, number>()

  register(path: string): () => void {
    const previousCount = this.counts.get(path) ?? 0
    this.counts.set(path, previousCount + 1)
    if (previousCount === 0) this.cancelPendingUnmount(path)
    if (previousCount === 0 && !this.emittedMounted.has(path)) {
      this.emittedMounted.add(path)
      this.emit(path, true)
    }
    let registered = true
    return () => {
      if (!registered) return

      registered = false
      const count = this.counts.get(path) ?? 0
      if (count <= 1) {
        this.counts.delete(path)
        this.scheduleUnmount(path)
        return
      }
      this.counts.set(path, count - 1)
    }
  }

  has(path: string): boolean {
    return this.counts.has(path)
  }

  subscribe(listener: (path: string, mounted: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(path: string, mounted: boolean): void {
    for (const listener of this.listeners) listener(path, mounted)
  }

  private cancelPendingUnmount(path: string): void {
    this.transitionGeneration.set(path, (this.transitionGeneration.get(path) ?? 0) + 1)
  }

  private scheduleUnmount(path: string): void {
    const generation = (this.transitionGeneration.get(path) ?? 0) + 1
    this.transitionGeneration.set(path, generation)
    queueMicrotask(() => {
      if (this.counts.has(path)) return
      if (this.transitionGeneration.get(path) !== generation) return

      this.transitionGeneration.delete(path)
      if (!this.emittedMounted.delete(path)) return
      this.emit(path, false)
    })
  }
}
