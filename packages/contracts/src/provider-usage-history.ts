import * as v from 'valibot'

const count = v.pipe(v.number(), v.integer(), v.minValue(0))
const timestamp = v.nullable(v.pipe(v.string(), v.isoTimestamp()))

/** Source identifiers are opaque. Native paths and account identifiers stay on the scanning host. */
export const providerUsageHistorySourceSchema = v.object({
  id: v.string(),
  hostId: v.string(),
  driverKind: v.string(),
  sourceKind: v.picklist(['native-transcript', 'fregat-utility', 'fregat-session']),
  unidentifiedRecords: count,
  status: v.picklist(['pending', 'ready', 'partial', 'absent', 'unreadable']),
  scannedAt: timestamp,
  latestEventAt: timestamp,
  files: count,
  records: count,
  malformedLines: count,
  oversizedLines: count,
})

/** Coverage describes local transcript stores, independently of subscription allowance observations. */
export const providerUsageHistoryCoverageSchema = v.object({
  scope: v.literal('local-transcripts'),
  accountAttribution: v.literal('unverified'),
  costMeaning: v.literal('api-equivalent-estimate'),
  status: v.picklist(['pending', 'ready', 'partial', 'scanning']),
  scannedAt: timestamp,
  bytesRead: count,
  sources: v.array(providerUsageHistorySourceSchema),
})

export type ProviderUsageHistorySource = v.InferOutput<typeof providerUsageHistorySourceSchema>
export type ProviderUsageHistoryCoverage = v.InferOutput<typeof providerUsageHistoryCoverageSchema>
