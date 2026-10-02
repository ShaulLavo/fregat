import * as v from 'valibot'

/** POSIX `/x`, drive `C:\x` or `C:/x`, or UNC `\\host\share`. Drive-relative `C:x` and NUL are refused. */
export const absolutePathSchema = v.pipe(
  v.string(),
  v.maxLength(4096),
  v.regex(/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/, 'An absolute path'),
  v.check((value) => !value.includes('\0'), 'A path holds no NUL byte'),
)
