import * as v from 'valibot'

const absolutePath = v.pipe(
  v.string(),
  v.startsWith('/'),
  v.check((value) => !value.includes('\0') && !value.includes('\r') && !value.includes('\n')),
)

export const installationSchema = v.object({
  kind: v.literal('source'),
  directory: absolutePath,
  executable: absolutePath,
})

export type ServerInstallation = v.InferOutput<typeof installationSchema>
