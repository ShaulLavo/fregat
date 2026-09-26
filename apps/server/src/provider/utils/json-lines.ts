/**
 * Parsed rows of a JSONL file, streamed: a rollout can be hundreds of megabytes.
 * `keep` skips lines before parsing, which is where the cost is.
 */
export async function readJsonLines(
  filePath: string,
  keep: (line: string) => boolean = () => true,
) {
  const rows: unknown[] = []
  let pending = ''
  for await (const chunk of Bun.file(filePath).stream().pipeThrough(new TextDecoderStream())) {
    const lines = (pending + chunk).split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) addRow(rows, line, keep)
  }
  addRow(rows, pending, keep)
  return rows
}

function addRow(rows: unknown[], line: string, keep: (line: string) => boolean) {
  if (!line || !keep(line)) return
  try {
    rows.push(JSON.parse(line))
  } catch {
    // A torn last line from a live writer; the next read has it whole.
  }
}
