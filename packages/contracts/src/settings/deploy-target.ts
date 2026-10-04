import * as v from 'valibot'

// End lookaheads reject final line terminators that `$` accepts.
export const deployTargetSchema = v.object({
  productionRoot: v.pipe(
    v.string(),
    v.regex(/^(?!\/+$)(?!.*\/\.\.?(?:\/|$))\/[^\s%"'$\\\0]{1,4095}(?![\s\S])/),
  ),
  meshHost: v.pipe(v.string(), v.regex(/^[a-zA-Z\d][\w.-]*(?![\s\S])/)),
  meshOrigin: v.pipe(
    v.string(),
    v.check((origin) => /^https?:\/\//.test(origin) && URL.parse(origin)?.origin === origin),
  ),
  meshRoute: v.pipe(v.string(), v.regex(/^\/(?:[\w-]+\/)*[\w-]*(?![\s\S])/)),
})
