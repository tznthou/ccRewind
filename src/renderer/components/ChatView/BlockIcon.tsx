/**
 * 思考過程與工具區塊的圖示（裁決 20：兩個主題都從 🧠🔧📋 換成線條圖示，顏色跟著字走 currentColor）。
 * 畫在 14×14 裡，線寬 1.5、圓角端點（同 ThemeSwitcher 與 Token Budget 的 EventIcon）；1em 大，跟著外層 .icon 的字級。
 */
type Kind = 'thinking' | 'toolUse' | 'toolResult'

function Shape({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'thinking':
      // 燈泡：推理過程
      return (
        <>
          <path d="M5 9.6A4 4 0 1 1 9 9.6V11H5z" />
          <line x1="5.5" y1="13" x2="8.5" y2="13" />
        </>
      )
    case 'toolUse':
      // 扳手：呼叫工具（直立畫好再轉 45 度）
      return (
        <g transform="rotate(45 7 7)">
          <path d="M5 1.5v2a2 2 0 0 0 4 0v-2" />
          <line x1="7" y1="5.5" x2="7" y2="12.5" />
        </g>
      )
    case 'toolResult':
      // 寫字板：工具回來的結果
      return (
        <>
          <rect x="2.5" y="2.5" width="9" height="10.5" rx="1.2" />
          <path d="M5 1.5h4v2H5z" />
          <line x1="4.75" y1="7" x2="9.25" y2="7" />
          <line x1="4.75" y1="9.5" x2="7.75" y2="9.5" />
        </>
      )
  }
}

export default function BlockIcon({ kind }: { kind: Kind }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <Shape kind={kind} />
    </svg>
  )
}
