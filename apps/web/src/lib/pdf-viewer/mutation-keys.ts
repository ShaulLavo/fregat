export const pdfMutationKeys = {
  engine: ['pdf', 'load-engine'],
  open: ['pdf', 'open'],
  render: (page: number) => ['pdf', 'render', page],
} as const
