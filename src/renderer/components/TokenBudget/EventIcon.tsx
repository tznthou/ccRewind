import type { SVGProps } from 'react'
import { DefaultZIndexes, ZIndexLayer } from 'recharts'
import type { SessionEvent } from './sessionStory'
import styles from './TokenBudget.module.css'

type Kind = SessionEvent['kind']

/** 四種事件的線條，畫在 14×14 裡；畫法跟 ThemeSwitcher 一樣（線寬 1.5、圓角端點） */
function Shape({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'compaction':
      // 上下往中線擠：對話被壓縮
      return (
        <>
          <line x1="2" y1="7" x2="12" y2="7" />
          <polyline points="4.5,1.5 7,4 9.5,1.5" />
          <polyline points="4.5,12.5 7,10 9.5,12.5" />
        </>
      )
    case 'idle_expired':
      // 時鐘：離開太久
      return (
        <>
          <circle cx="7" cy="7" r="5.5" />
          <polyline points="7,4 7,7 9,8.5" />
        </>
      )
    case 'model_switch':
      // 左右互換：換模型
      return (
        <>
          <line x1="2" y1="4.5" x2="12" y2="4.5" />
          <polyline points="9.5,2 12,4.5 9.5,7" />
          <line x1="12" y1="9.5" x2="2" y2="9.5" />
          <polyline points="4.5,7 2,9.5 4.5,12" />
        </>
      )
    case 'unknown':
      // 圓圈問號：原因不明（是 info 不是警告，不用警告三角）
      return (
        <>
          <circle cx="7" cy="7" r="5.5" />
          <path d="M5.25 5.25a1.75 1.75 0 1 1 2.6 1.53c-.5.28-.85.6-.85 1.1v.37" />
          <circle cx="7" cy="10.25" r="0.75" fill="currentColor" stroke="none" />
        </>
      )
  }
}

type IconSvgProps = {
  kind: Kind
  /** 先用底色把同一個形狀加粗、填滿畫一次：線條圖示是空心的，不墊底的話圖上密集的線會穿過圖示 */
  halo?: boolean
} & Pick<SVGProps<SVGSVGElement>, 'x' | 'y' | 'width' | 'height'>

function IconSvg({ kind, halo = false, ...box }: IconSvgProps) {
  return (
    <svg
      {...box}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.eventIcon}
      aria-hidden="true"
    >
      {halo && (
        <g className={styles.eventIconHalo} strokeWidth="3.5">
          <Shape kind={kind} />
        </g>
      )}
      <Shape kind={kind} />
    </svg>
  )
}

/** 清單與圖例裡的圖示；大小由所在的區塊決定（跟著字級縮放） */
export function EventIcon({ kind }: { kind: Kind }) {
  return <IconSvg kind={kind} width="14" height="14" />
}

const CHART_ICON_SIZE = 14

interface ChartEventIconProps {
  kind: Kind
  /** recharts 依 position 算好的錨點（'top'：標記頂端再往上 offset），cloneElement 時傳進來 */
  x?: number | string
  y?: number | string
}

/**
 * 圖上標記的圖示，當 label 的 content 用：`label={{ position: 'top', content: <ChartEventIcon … /> }}`。
 * 圖示底邊的中點對齊錨點，跟 recharts 內建的文字標籤一樣疊在標記上方。
 * - content 不會自動進 label 圖層，要自己包 ZIndexLayer：不包會掉到標記自己的圖層，被 tooltip 的游標線與 active dot 蓋過
 * - recharts 也會傳 viewBox、position、content 等 props 進來，不往 <svg> 上展開
 */
export function ChartEventIcon({ kind, x, y }: ChartEventIconProps) {
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <IconSvg
        kind={kind}
        halo
        x={x - CHART_ICON_SIZE / 2}
        y={y - CHART_ICON_SIZE}
        width={CHART_ICON_SIZE}
        height={CHART_ICON_SIZE}
      />
    </ZIndexLayer>
  )
}
