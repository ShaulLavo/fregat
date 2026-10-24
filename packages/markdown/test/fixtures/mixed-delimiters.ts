const runs = ['*', '**', '***', '_', '__', '___', '~', '~~']

function combinations(outer: string, inner: string): string[] {
  const spans = [
    `${outer}${inner}a${inner}${outer}`,
    `${outer}${inner}a${outer}${inner}`,
    `${outer}${inner}${outer}a${inner}${outer}`,
    `${outer}(${inner}a${inner})${outer}`,
  ]
  return spans.flatMap((span) => [`p ${span} q`, `x${span}y`, `p (${span})! q`])
}

const generated = runs.flatMap((outer) => runs.flatMap((inner) => combinations(outer, inner)))
export const MIXED_DELIMITER_SOURCES = Array.from(
  new Set(['~_~a_~', '*~~a*~~', '*~~*a~~*'].concat(generated)),
)
