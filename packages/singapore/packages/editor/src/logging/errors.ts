const evlogErrorInternalKey = Symbol.for('editor.evlog.error.internal')

export type EditorEvlogErrorOptions = {
  readonly cause?: Error
  readonly code?: string
  readonly fix?: string
  readonly internal?: Record<string, unknown>
  readonly link?: string
  readonly message: string
  readonly status?: number
  readonly why?: string
}

export class EditorEvlogError extends Error {
  private readonly [evlogErrorInternalKey]?: Record<string, unknown>

  public readonly code?: string
  public readonly fix?: string
  public readonly link?: string
  public readonly status: number
  public readonly why?: string

  public constructor(options: EditorEvlogErrorOptions | string) {
    const resolved = typeof options === 'string' ? { message: options } : options
    super(resolved.message, { cause: resolved.cause })
    this.name = 'EvlogError'
    this.code = resolved.code
    this.fix = resolved.fix
    this.link = resolved.link
    this.status = resolved.status ?? 500
    this.why = resolved.why
    if (resolved.internal !== undefined) this.defineInternal(resolved.internal)
  }

  public get internal(): Record<string, unknown> | undefined {
    return this[evlogErrorInternalKey]
  }

  public get statusText(): string {
    return this.message
  }

  public get statusCode(): number {
    return this.status
  }

  public get statusMessage(): string {
    return this.message
  }

  public get data(): Record<string, unknown> | undefined {
    if (!this.code && !this.why && !this.fix && !this.link) return undefined
    return {
      code: this.code,
      why: this.why,
      fix: this.fix,
      link: this.link,
    }
  }

  public toString(): string {
    return evlogErrorLines(this).join('\n')
  }

  public toJSON(): Record<string, unknown> {
    const serialized: Record<string, unknown> = {
      message: this.message,
      name: this.name,
      status: this.status,
    }
    if (this.data) serialized.data = this.data
    if (this.cause instanceof Error) {
      serialized.cause = {
        message: this.cause.message,
        name: this.cause.name,
      }
    }
    return serialized
  }

  private defineInternal(internal: Record<string, unknown>): void {
    Object.defineProperty(this, evlogErrorInternalKey, {
      configurable: true,
      enumerable: false,
      value: internal,
      writable: false,
    })
  }
}

export function createError(options: EditorEvlogErrorOptions | string): EditorEvlogError {
  return new EditorEvlogError(options)
}

export { createError as createEvlogError }

function evlogErrorLines(error: EditorEvlogError): string[] {
  const lines = [`Error: ${error.message}`]
  if (error.code) lines.push(`Code: ${error.code}`)
  if (error.why) lines.push(`Why: ${error.why}`)
  if (error.fix) lines.push(`Fix: ${error.fix}`)
  if (error.link) lines.push(`More info: ${error.link}`)
  if (error.cause instanceof Error) lines.push(`Caused by: ${error.cause.message}`)
  return lines
}
