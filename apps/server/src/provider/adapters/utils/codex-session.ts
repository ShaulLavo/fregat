import * as v from 'valibot'

// Resuming needs metadata; historical tool items must not block opening the thread.
export const codexSessionResumeSchema = v.object({
  cwd: v.string(),
  model: v.string(),
  thread: v.object({ id: v.string() }),
})
