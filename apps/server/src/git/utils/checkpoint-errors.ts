import { defineErrorCatalog } from 'evlog'

export const gitCheckpointErrors = defineErrorCatalog('git', {
  CHECKPOINT_COMMIT_EMPTY: {
    status: 500,
    message: ({ ref }: { ref: string }) =>
      `git commit-tree produced no commit for checkpoint ${ref}`,
    why: 'commit-tree exited successfully but wrote nothing to stdout, so there is no object id to point the checkpoint ref at.',
    fix: 'Check the repository for a broken commit identity or a hook that swallows plumbing output, then recapture the checkpoint.',
  },
  CHECKPOINT_REF_UNAVAILABLE: {
    status: 404,
    message: ({ ref }: { ref: string }) => `This checkpoint no longer exists: ${ref}`,
    why: 'It was never saved, was removed by a revert, or was cleaned up by Git, so there is nothing to compare against.',
    fix: 'Compare against a turn whose checkpoint still exists.',
  },
  CHECKPOINT_TREE_EMPTY: {
    status: 500,
    message: ({ ref }: { ref: string }) => `git write-tree produced no tree for checkpoint ${ref}`,
    why: 'write-tree exited successfully but wrote nothing to stdout, which means the temporary checkpoint index was never populated.',
    fix: 'Verify the workspace path is inside the repository and that GIT_INDEX_FILE is writable, then recapture the checkpoint.',
  },
})
