export const resourceQueryKeys = {
  database: (name: string, version: number) => ['resources', 'database', name, version] as const,
}
