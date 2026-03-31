/** 從完整路徑取得檔名（支援 / 和 \ 分隔符） */
export function basename(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath
}

/** 從完整路徑取得最後一段目錄名 */
export function lastSegment(dirPath: string): string {
  const trimmed = dirPath.replace(/[/\\]+$/, '')
  return basename(trimmed) || dirPath
}
