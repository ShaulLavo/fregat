export class CollabFailure extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'CollabFailure'
  }
}
