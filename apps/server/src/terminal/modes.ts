export class TerminalModes {
  inBandResize = false
  private state: 'ground' | 'escape' | 'csi' | 'private' | 'string' | 'string-escape' = 'ground'
  private parameter = 0
  private resizeParameter = false

  write(bytes: Uint8Array) {
    for (let index = 0; index < bytes.length; index += 1) {
      if (this.state === 'ground') {
        index = bytes.indexOf(0x1b, index)
        if (index === -1) return
      }
      this.consume(bytes[index])
    }
  }

  private consume(byte: number) {
    if (this.state === 'string' || this.state === 'string-escape') {
      this.consumeString(byte)
      return
    }
    if (byte === 0x1b) {
      this.state = 'escape'
      return
    }
    if (this.state === 'escape') {
      this.consumeEscape(byte)
      return
    }
    if (this.state === 'csi') {
      this.state = byte === 0x3f ? 'private' : 'ground'
      this.parameter = 0
      this.resizeParameter = false
      return
    }
    if (this.state !== 'private') return
    this.consumeParameter(byte)
  }

  private consumeEscape(byte: number) {
    this.state = byte === 0x5b ? 'csi' : 'ground'
    if (byte === 0x63) this.inBandResize = false
    if (byte === 0x5d || byte === 0x50 || byte === 0x5e || byte === 0x5f) this.state = 'string'
  }

  private consumeString(byte: number) {
    if (byte === 0x07 || (this.state === 'string-escape' && byte === 0x5c)) {
      this.state = 'ground'
      return
    }
    this.state = byte === 0x1b ? 'string-escape' : 'string'
  }

  private consumeParameter(byte: number) {
    if (byte >= 0x30 && byte <= 0x39) {
      this.parameter = Math.min(100_000, this.parameter * 10 + byte - 0x30)
      return
    }
    this.resizeParameter ||= this.parameter === 2048
    if (byte === 0x3b) {
      this.parameter = 0
      return
    }
    if (this.resizeParameter && (byte === 0x68 || byte === 0x6c)) this.inBandResize = byte === 0x68
    this.state = 'ground'
  }
}
