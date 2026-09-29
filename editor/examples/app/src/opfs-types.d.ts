interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean
}

interface FileSystemGetDirectoryOptions {
  create?: boolean
}

interface FileSystemGetFileOptions {
  create?: boolean
}

interface FileSystemRemoveOptions {
  recursive?: boolean
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandle {
  createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>
}

interface FileSystemDirectoryHandle {
  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle>
  getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle>
  removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void>
}

interface StorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>
}
