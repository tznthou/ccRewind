// scripts/cdp-client.mjs 的純函式部分。
//
// 為什麼值得測一支「開發用工具」：這些函式守的都是「工具靜默回報成功」的失效模式——
// 路徑防護擋的是覆寫 ~/.claude/ 造成不可逆資料損失，wx 擋的是任何形式的覆寫，
// rect 檢查擋的是對著 0x0 的空圖說「已存檔」。連線層（逾時、CDP 協定錯誤、斷線）
// 需要架一個假 CDP server 才測得到，不在這裡涵蓋。
//
// 受保護根目錄一律用 mkdtemp 造假的，不碰真實 ~/.claude/：一來那是專案明文規定，
// 二來乾淨的 CI worker 上根本沒有那個目錄，靠它會讓測試結果隨環境浮動。
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, linkSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'

import { assertSafeOutputPath, defaultProtectedRoot, isUsableRect, writeFileNoClobber } from '../scripts/cdp-client.mjs'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ccrewind-cdp-test-'))
  tempDirs.push(dir)
  return dir
}

/** 造一個假的家目錄，裡面有假的 .claude/，模擬真實佈局但完全隔離。 */
function makeFakeHome(): { home: string; claudeDir: string } {
  const home = makeTempDir()
  const claudeDir = join(home, '.claude')
  mkdirSync(join(claudeDir, 'projects', 'some-project'), { recursive: true })
  return { home, claudeDir }
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('assertSafeOutputPath', () => {
  it('拒絕直接寫進受保護目錄底下的檔案', () => {
    const { claudeDir } = makeFakeHome()
    expect(() => assertSafeOutputPath(join(claudeDir, 'shot.png'), claudeDir)).toThrow(/唯讀承諾/)
  })

  it('拒絕深層路徑（真實 session JSONL 的所在）', () => {
    const { claudeDir } = makeFakeHome()
    const victim = join(claudeDir, 'projects', 'some-project', 'session.jsonl')
    expect(() => assertSafeOutputPath(victim, claudeDir)).toThrow(/唯讀承諾/)
  })

  it('拒絕受保護目錄本身', () => {
    const { claudeDir } = makeFakeHome()
    expect(() => assertSafeOutputPath(claudeDir, claudeDir)).toThrow(/唯讀承諾/)
  })

  it('拒絕用 .. 繞回受保護目錄的路徑', () => {
    const { claudeDir } = makeFakeHome()
    const sneaky = join(claudeDir, 'projects', '..', 'settings.json')
    expect(() => assertSafeOutputPath(sneaky, claudeDir)).toThrow(/唯讀承諾/)
  })

  it('拒絕經由 symlink 指向受保護目錄的路徑', () => {
    const { claudeDir } = makeFakeHome()
    const dir = makeTempDir()
    const link = join(dir, 'looks-harmless')
    symlinkSync(claudeDir, link, 'dir')
    expect(() => assertSafeOutputPath(join(link, 'shot.png'), claudeDir)).toThrow(/唯讀承諾/)
  })

  it('允許一般的輸出路徑，並回傳 realpath 解析後的絕對路徑', () => {
    const { claudeDir } = makeFakeHome()
    const dir = makeTempDir()
    const target = join(dir, 'shot.png')
    expect(() => assertSafeOutputPath(target, claudeDir)).not.toThrow()
    // 期望值要自己也走一次 realpath：macOS 的 /var 是 /private/var 的 symlink，
    // mkdtemp 給的路徑經解析後會變成 /private/var/...。回傳 realpath 是刻意的——
    // symlink 防護靠它，寫檔也該落在解析後的真實位置。
    expect(assertSafeOutputPath(target, claudeDir)).toBe(join(realpathSync(dir), 'shot.png'))
  })

  it('允許名字裡剛好含 .claude 但不在該目錄下的路徑', () => {
    const { claudeDir } = makeFakeHome()
    const dir = makeTempDir()
    expect(() => assertSafeOutputPath(join(dir, '.claude-notes.png'), claudeDir)).not.toThrow()
  })

  it('允許尚未建立的巢狀輸出目錄（路徑不存在不等於不安全）', () => {
    const { claudeDir } = makeFakeHome()
    const dir = makeTempDir()
    mkdirSync(join(dir, 'a'), { recursive: true })
    expect(() => assertSafeOutputPath(join(dir, 'a', 'b', 'c', 'shot.png'), claudeDir)).not.toThrow()
  })

  // 下面兩條合起來才防得住「預設值悄悄改掉」的退化，缺一條都會變成空測試：
  // 前者驗根目錄是怎麼組出來的（完全隔離），後者驗那個預設真的接到了 assertSafeOutputPath。
  // 反過來用 defaultProtectedRoot() 去組期望值是套套邏輯——預設改成 /wrong 也照樣綠。
  it('預設受保護根目錄＝家目錄 + .claude', () => {
    const fakeHome = makeTempDir()
    expect(defaultProtectedRoot(fakeHome)).toBe(join(fakeHome, '.claude'))
  })

  it('不傳 protectedRoot 時，實際擋下的是家目錄底下的 .claude', () => {
    // 用假家目錄取代真實的：os.homedir() 在 POSIX 上讀 $HOME，覆寫它就能驗到
    // 「預設值真的接上了 assertSafeOutputPath」，同時完全不碰開發者或 CI 的 ~/.claude/。
    // 預設值若被改掉或防護被拿掉，這條會紅。
    const { claudeDir } = makeFakeHome()
    const origHome = process.env.HOME
    process.env.HOME = dirname(claudeDir)
    try {
      expect(() => assertSafeOutputPath(join(claudeDir, 'shot.png'))).toThrow(/唯讀承諾/)
    } finally {
      if (origHome === undefined) delete process.env.HOME
      else process.env.HOME = origHome
    }
  })
})

describe('writeFileNoClobber', () => {
  it('可以寫出新檔案', () => {
    const dir = makeTempDir()
    const target = join(dir, 'shot.png')
    writeFileNoClobber(target, Buffer.from('png-bytes'))
    expect(readFileSync(target, 'utf8')).toBe('png-bytes')
  })

  it('拒絕覆寫既有檔案，且原內容一個 byte 都沒被動到', () => {
    const dir = makeTempDir()
    const victim = join(dir, 'precious.jsonl')
    writeFileSync(victim, '{"irreplaceable":true}')
    expect(() => writeFileNoClobber(victim, Buffer.from('png-bytes'))).toThrow(/拒絕覆寫/)
    expect(readFileSync(victim, 'utf8')).toBe('{"irreplaceable":true}')
  })

  it('hard link 也擋得住——路徑名檢查看不出來，但 wx 由核心判定', () => {
    const dir = makeTempDir()
    const original = join(dir, 'session.jsonl')
    writeFileSync(original, '{"irreplaceable":true}')
    const alias = join(dir, 'innocent-looking.png')
    // hard link：同一個 inode 的另一個名字。realpath 解不出關聯，路徑名檢查必然漏掉，
    // 擋下它的是 wx（O_EXCL 由核心在開檔當下判定「目標已存在」）。
    linkSync(original, alias)
    expect(() => writeFileNoClobber(alias, Buffer.from('png-bytes'))).toThrow(/拒絕覆寫/)
    expect(readFileSync(original, 'utf8')).toBe('{"irreplaceable":true}')
  })

  it('非 EEXIST 的錯誤原樣往上拋（不吞掉真正的 I/O 問題）', () => {
    const dir = makeTempDir()
    // 用檔案當目錄用，讓 open 回 ENOTDIR 而非 EEXIST
    const notADir = join(dir, 'file-in-the-way')
    writeFileSync(notADir, 'x')
    expect(() => writeFileNoClobber(join(notADir, 'shot.png'), Buffer.from('x')))
      .toThrow(/ENOTDIR/)
  })
})

describe('isUsableRect', () => {
  it('接受有實際面積的矩形', () => {
    expect(isUsableRect({ x: 0, y: 0, width: 279, height: 174 })).toBe(true)
  })

  it('擋掉零寬（display:none 或尚未 layout 的元素）', () => {
    expect(isUsableRect({ x: 0, y: 0, width: 0, height: 174 })).toBe(false)
  })

  it('擋掉零高', () => {
    expect(isUsableRect({ x: 0, y: 0, width: 279, height: 0 })).toBe(false)
  })

  it('擋掉整個零尺寸的矩形', () => {
    expect(isUsableRect({ x: 0, y: 0, width: 0, height: 0 })).toBe(false)
  })

  it('擋掉 null（querySelector 沒命中）', () => {
    expect(isUsableRect(null)).toBe(false)
  })
})

// resolve 只在下面這個健檢用到：確認 mkdtemp 給的是絕對路徑，
// 避免上面所有斷言建立在相對路徑的假設上。
describe('測試前提', () => {
  it('mkdtemp 回傳絕對路徑', () => {
    const dir = makeTempDir()
    expect(dir).toBe(resolve(dir))
  })
})
