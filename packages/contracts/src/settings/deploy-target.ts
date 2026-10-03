import * as v from 'valibot'

export const deployTargetSchema = v.pipe(
  v.object({
    productionRoot: v.pipe(
      v.string(),
      v.maxLength(4096),
      v.regex(/^\/[^\s%"'$\\\0]*$/, 'Use an absolute Unix path suitable for a systemd unit.'),
      v.check(
        (root) =>
          !/^\/+$/u.test(root) &&
          !root.split('/').some((segment) => segment === '.' || segment === '..'),
        'Select a dedicated production directory without relative segments.',
      ),
    ),
    meshHost: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)),
    meshOrigin: v.pipe(
      v.string(),
      v.check((origin) => {
        try {
          const url = new URL(origin)
          return (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            url.origin === origin &&
            !url.username &&
            !url.password
          )
        } catch {
          return false
        }
      }, 'Use an HTTP or HTTPS origin without a path or credentials.'),
    ),
    meshRoute: v.pipe(
      v.string(),
      v.regex(/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?|)$/, 'Use an absolute route path.'),
    ),
  }),
  v.check(
    (target) => Object.values(target).every((value) => value.trim() === value),
    'Deployment target fields have no surrounding whitespace.',
  ),
)
