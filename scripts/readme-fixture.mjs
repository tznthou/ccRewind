// README 截圖用的合成 Claude Code 對話紀錄：專案、對話內容與 token 數字全是虛構的。
//
// 主 session 刻意讓同一個 Token Budget 面板出現每一種事件：
//   第 25 次呼叫換模型、第 41 次呼叫是離開 92 分鐘後回來（閒置過期）、最長 context 超過 200K（1M 視窗的證據）、
//   第 58 次呼叫前對話被壓縮、第 70 次呼叫距上一次 9 分鐘、模型沒變卻快取中斷（原因不明）。
// 另外三個短 session 只是讓側欄看起來像平常的樣子。
// 輸出是固定的：uuid 由內容推導、不用亂數，跑兩次得到同樣的檔案。
//
// 用法：node scripts/readme-fixture.mjs <假 HOME>
//   在假 HOME 底下寫出對話紀錄，結構跟 ~/.claude/projects 一樣（<專案>/<session>.jsonl）。用這個假 HOME 開 app
//   （例如 HOME=<假 HOME> pnpm dev），app 會在 <假 HOME>/.ccrewind/ 建自己的索引，不碰真正的 ~/.claude 與 ~/.ccrewind。
//   README 的截圖是開主 session（-Users-demo-projects-weatherdashboard 裡呼叫最多的那個）的 Token Budget 拍的。

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const COMPACT_PREFIX = 'This session is being continued from a previous conversation that ran out of context.'
/** 每次呼叫都讀得到的部分（system prompt 與工具定義，全域快取還熱著） */
const SYSTEM_PROMPT_CACHED = 14_000

/** RFC 4122 第 5 版 uuid（URL namespace），跟 Python 的 uuid.uuid5(uuid.NAMESPACE_URL, name) 一樣 */
function uuid5(name) {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
  const hash = createHash('sha1').update(Buffer.concat([namespace, Buffer.from(name, 'utf8')])).digest()
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const uid = (...parts) => uuid5('ccrewind-readme/' + parts.join('/'))

class Session {
  constructor(projectDir, cwd, key, start, title) {
    Object.assign(this, { projectDir, cwd, key })
    this.sessionId = uid('session', key)
    this.t = start
    this.entries = []
    this.parent = null
    this.prevTotal = null
    this.calls = 0
    this.addUser(title)
  }

  base(type) {
    const e = {
      type, uuid: uid(this.key, this.entries.length), parentUuid: this.parent,
      timestamp: this.t.toISOString(), sessionId: this.sessionId, cwd: this.cwd,
      version: '2.1.280', gitBranch: 'main', userType: 'external', isSidechain: false,
    }
    this.parent = e.uuid
    return e
  }

  addUser(text, compact = false) {
    const e = this.base('user')
    e.message = { role: 'user', content: text }
    if (compact) e.isCompactSummary = true
    this.entries.push(e)
  }

  /** 一次 API 呼叫。read 不給時是正常的一輪：上一次的整段 prompt 都從快取讀到 */
  call(minutesLater, total, model, text, { read = null, output = 600 } = {}) {
    this.t = new Date(this.t.getTime() + minutesLater * 60_000)
    const cacheRead = read ?? this.prevTotal ?? SYSTEM_PROMPT_CACHED
    const fresh = 3
    this.calls += 1
    const e = this.base('assistant')
    e.requestId = 'req_' + uid(this.key, 'req', this.calls).replaceAll('-', '').slice(0, 24)
    e.message = {
      id: 'msg_' + uid(this.key, 'msg', this.calls).replaceAll('-', '').slice(0, 24),
      type: 'message', role: 'assistant', model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: fresh,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: Math.max(0, total - cacheRead - fresh),
        output_tokens: output,
      },
    }
    this.entries.push(e)
    this.prevTotal = total
  }

  compact(minutesLater, summary) {
    this.t = new Date(this.t.getTime() + minutesLater * 60_000)
    this.addUser(`${COMPACT_PREFIX} The conversation is summarized below:\n\n${summary}`, true)
    this.prevTotal = null // 壓縮後的第一次呼叫只讀得到 system prompt
  }

  write(home) {
    const dir = path.join(home, '.claude', 'projects', this.projectDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${this.sessionId}.jsonl`), this.entries.map(e => JSON.stringify(e) + '\n').join(''))
  }
}

const PROMPTS = [
  'Read the forecast service and the chart component first.',
  'The tooltip should show the date in the user\'s locale.',
  'Add a unit toggle between Celsius and Fahrenheit.',
  'Write tests for the conversion helpers.',
  'Run the test suite and fix whatever fails.',
  'Make the chart responsive below 600px.',
  'Cache the API response for ten minutes.',
  'Explain why the second request still hits the network.',
]

/** 長短不一的回覆，讓輸出強度熱力條有幾個熱點 */
const outputFor = i => (i % 11 === 0 ? 2600 : i % 5 === 0 ? 1400 : 350 + (i * 137) % 600)

const at = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi))

function mainSession() {
  const s = new Session('-Users-demo-projects-weatherdashboard', '/Users/demo/projects/weatherdashboard', 'main',
    at(2026, 9, 18, 1, 5), 'Add a 7-day forecast chart to the dashboard, with a hover tooltip per day.')
  const sonnet = 'claude-sonnet-4-5'
  const opus = 'claude-opus-4-6'
  let total = 24_000
  for (let i = 1; i <= 84; i++) {
    if (i > 1) s.addUser(PROMPTS[i % PROMPTS.length])
    const text = `Step ${i}: done.`
    const output = outputFor(i)
    if (i === 25) {
      // 換模型：新模型有自己的快取，整段對話一點都讀不到
      total += 4_000
      s.call(3, total, opus, text, { read: 0, output })
    } else if (i === 41) {
      // 午休 92 分鐘後回來：1 小時的快取已經過期
      total += 2_000
      s.call(92, total, opus, text, { read: 0, output })
    } else if (i === 58) {
      s.compact(2, 'The forecast chart, tooltip, unit toggle and response cache are done; tests pass.')
      total = 52_000
      s.call(1, total, opus, text, { output })
    } else if (i === 70) {
      // 距上一次 9 分鐘、模型沒變：找不出原因
      total += 3_000
      s.call(9, total, opus, text, { read: SYSTEM_PROMPT_CACHED, output })
    } else {
      if (i === 10) total += 18_000 // 讀了一個大檔案
      else if (i < 25) total += 3_500 + (i * 211) % 2_500
      else if (i < 41) total += 5_000 + (i * 173) % 3_000
      else if (i < 58) total += 4_500 + (i * 197) % 2_500
      else total += 3_000 + (i * 151) % 2_000
      s.call(2.5 + (i % 3), total, i < 25 ? sonnet : opus, text, { output })
    }
  }
  return s
}

function smallSession(projectDir, cwd, key, start, title, steps) {
  const s = new Session(projectDir, cwd, key, start, title)
  let total = 18_000
  for (let i = 1; i <= steps; i++) {
    if (i > 1) s.addUser(PROMPTS[(i + 3) % PROMPTS.length])
    total += 3_000 + (i * 97) % 2_000
    s.call(2 + (i % 2), total, 'claude-sonnet-4-5', `Step ${i}: done.`, { output: outputFor(i + 3) })
  }
  return s
}

const home = process.argv[2]
if (!home) {
  console.error('usage: node scripts/readme-fixture.mjs <fake HOME>')
  process.exit(1)
}
const sessions = [
  mainSession(),
  smallSession('-Users-demo-projects-weatherdashboard', '/Users/demo/projects/weatherdashboard', 'wd2',
    at(2026, 9, 17, 6, 40), 'Set up the project with Vite and the API client.', 12),
  smallSession('-Users-demo-projects-blogengine', '/Users/demo/projects/blogengine', 'blog1',
    at(2026, 9, 16, 2, 10), 'Add RSS feed generation for the posts.', 9),
  smallSession('-Users-demo-projects-blogengine', '/Users/demo/projects/blogengine', 'blog2',
    at(2026, 9, 15, 8, 30), 'Fix the broken pagination on the archive page.', 6),
]
for (const s of sessions) {
  s.write(home)
  console.log(`${s.projectDir} ${s.sessionId} calls=${s.calls}`)
}
