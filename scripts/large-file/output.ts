import path from 'node:path'

/** Where a run writes when --out is absent: FREGAT_EVIDENCE_ROOT, as the Pi lane sets it, else /work/tmp. */
export function defaultOutput(now = new Date(), root = process.env.FREGAT_EVIDENCE_ROOT) {
  const stamp = now.toISOString().replaceAll(/[-:.]/g, '')
  return path.join(root ?? '/work/tmp/fregat-evidence', `${stamp}-large-files`)
}
