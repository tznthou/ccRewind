/**
 * 專案下拉的選項文字：每個專案取「跟其他專案都不撞名」的最短尾段，先用最後一段，撞名的才往前補，補到不撞為止。
 *
 * 選項本來是完整路徑：共同前綴（/Users/<name>/Documents/…）很長，下拉的寬度又有上限，收合時被截掉的
 * 正好是分辨專案的最後一段。只用最後一段也不行：維護者的 133 個專案裡有 12 組最後一段同名。
 * 分隔符原樣保留（/ 與 \ 都認），完整路徑相同時就回傳完整路徑。
 */
export function projectLabels(paths: readonly string[]): string[] {
  const trimmed = paths.map(p => p.replace(/[/\\]+$/, ''))
  return trimmed.map((path, i) => {
    for (let k = 1; ; k++) {
      const label = suffix(path, k)
      if (label === path) return label
      if (!trimmed.some((other, j) => j !== i && suffix(other, k) === label)) return label
    }
  })
}

/** 最後 k 段（不足 k 段就是整個路徑） */
function suffix(path: string, k: number): string {
  let seen = 0
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === '/' || path[i] === '\\') {
      seen++
      if (seen === k) return path.slice(i + 1)
    }
  }
  return path
}
