import { describe, it, expect } from 'vitest'
import { projectLabels } from '../../src/renderer/components/Dashboard/projectLabels'

describe('projectLabels', () => {
  // 專案下拉收合時只看得到選中那一項：完整路徑有共同前綴，截斷後剩下的正是看不出是哪個專案的那段
  it('最後一段不撞名就只用最後一段', () => {
    expect(projectLabels(['/Users/me/Documents/ccRwind', '/Users/me/Documents/kira'])).toEqual(['ccRwind', 'kira'])
  })

  it('撞名的才往前補一段，沒撞名的維持一段', () => {
    expect(projectLabels(['/a/x/app', '/a/y/app', '/a/z/web'])).toEqual(['x/app', 'y/app', 'web'])
  })

  it('補一段還撞就一直補到不撞', () => {
    expect(projectLabels(['/p/q/r/app', '/s/q/r/app'])).toEqual(['p/q/r/app', 's/q/r/app'])
  })

  it('大小寫不同就是不同名稱', () => {
    expect(projectLabels(['/a/ai', '/a/AI'])).toEqual(['ai', 'AI'])
  })

  it('去掉結尾分隔符，也認得 Windows 的反斜線並原樣保留', () => {
    expect(projectLabels(['/a/app/', 'C:\\work\\app', 'D:\\work\\app'])).toEqual(['a/app', 'C:\\work\\app', 'D:\\work\\app'])
  })

  it('根目錄不會變成空白選項', () => {
    expect(projectLabels(['/', '/Users/me/app'])).toEqual(['/', 'app'])
  })

  it('完整路徑相同時回傳完整路徑（不會無限往前補）', () => {
    expect(projectLabels(['/a/app', '/a/app'])).toEqual(['/a/app', '/a/app'])
  })

  it('路徑都不同時，選項文字也都不同', () => {
    const paths = ['/u/a/app', '/u/b/app', '/v/a/app', '/u/a/web', '/u/c/d/app', '/w/c/d/app', '/x/app', '/app']
    const labels = projectLabels(paths)
    expect(new Set(labels).size).toBe(paths.length)
  })
})
