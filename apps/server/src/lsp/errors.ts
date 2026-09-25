import { defineErrorCatalog } from 'evlog'

export const lspErrors = defineErrorCatalog('lsp', {
  PROGRAM_ROOT_NOT_OPEN: {
    status: 403,
    message: 'This folder is not an open workspace',
    why: 'Program files are listed only for a workspace root this server has opened.',
    fix: 'Open the folder as a workspace, then try again.',
  },
  PROGRAM_TSCONFIG_OUTSIDE_ROOT: {
    status: 403,
    message: 'The TypeScript project file is outside the workspace',
    why: 'The tsconfig must sit inside the workspace root it is listed for.',
    fix: 'Pick a tsconfig inside the open workspace.',
  },
  PROGRAM_LIST_FAILED: {
    status: 422,
    message: 'TypeScript could not list the files of this project',
    why: 'The TypeScript compiler exited without naming any program file, usually because the tsconfig is invalid or matches no files.',
    fix: 'Run `tsc -p <tsconfig> --listFilesOnly` in the workspace and fix the errors it prints.',
  },
  PROGRAM_LIST_LIMIT: {
    status: 504,
    message: 'Listing the TypeScript program took too long or printed too much',
    why: 'The compiler run is bounded by time and output size, and this project exceeded one of them.',
    fix: 'Narrow the tsconfig `include` so the program holds fewer files.',
  },
})
