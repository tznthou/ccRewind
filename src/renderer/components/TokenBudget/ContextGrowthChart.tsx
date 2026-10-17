import { useId, useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer,
  type TooltipContentProps,
} from 'recharts'
import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { useI18n } from '../../i18n/useI18n'
import {
  chartRows, defaultLimit, eventItems, legendItems, timelineMarkers, tooltipContent,
  type ChartRow, type LegendId, type SessionFacts, type Translate,
} from './sessionStory'
import { CHART_TOOLTIP_STYLE, MARKER_COLORS } from './chartConstants'
import { ChartEventIcon, EventIcon } from './EventIcon'
import styles from './TokenBudget.module.css'

interface Props {
  stats: SessionTokenStats
  facts: SessionFacts
}

type LimitId = 'none' | '200k' | '1m'

const LIMIT_VALUES: Record<Exclude<LimitId, 'none'>, { label: string; value: number }> = {
  '200k': { label: '200K', value: 200_000 },
  '1m': { label: '1M', value: 1_000_000 },
}

function ChartTooltip({ active, payload, titles, t }: TooltipContentProps & {
  titles: ReadonlyMap<string, string>
  t: Translate
}) {
  const row = payload?.[0]?.payload as ChartRow | undefined
  if (!active || !row) return null
  const content = tooltipContent(row, titles, t)
  return (
    <div className={styles.chartTooltip} style={CHART_TOOLTIP_STYLE}>
      <div className={styles.chartTooltipHead}>{content.head}</div>
      <div>{content.length}</div>
      <div className={styles.chartTooltipMuted}>{content.breakdown}</div>
      {content.events.map(title => <div key={title} className={styles.chartTooltipEvent}>{title}</div>)}
    </div>
  )
}

/** 圖例前面那個小記號：跟圖上畫的一樣（壓縮多到改淡色實線時，圖例也跟著改） */
function LegendMark({ id, faintCompactions }: { id: LegendId; faintCompactions: boolean }) {
  switch (id) {
    case 'area':
      return (
        <svg width="18" height="10" aria-hidden="true">
          <rect width="18" height="10" fill="var(--color-accent)" fillOpacity={0.16} />
          <line x1="0" y1="1" x2="18" y2="1" stroke="var(--color-accent)" strokeWidth={1.5} />
        </svg>
      )
    case 'compaction':
      return (
        <svg width="10" height="12" aria-hidden="true">
          <line
            x1="5" y1="0" x2="5" y2="12"
            stroke="var(--color-text-secondary)"
            strokeDasharray={faintCompactions ? undefined : '3 2'}
            strokeOpacity={faintCompactions ? 0.35 : 1}
          />
        </svg>
      )
    case 'overflow':
      return null
    default:
      return <EventIcon kind={id} />
  }
}

export default function ContextGrowthChart({ stats, facts }: Props) {
  const { t } = useI18n()
  const titleId = useId()
  // 手動選的上限只改參考線，不回寫 facts：故事句與卡片照舊
  const [limit, setLimit] = useState<LimitId>(() => defaultLimit(facts))

  const rows = useMemo(() => chartRows(stats, facts), [stats, facts])
  const markers = useMemo(() => timelineMarkers(facts), [facts])
  // tooltip 查完整事件（含沒被畫成標記的）
  const titles = useMemo(() => new Map(eventItems(facts, t).map(e => [e.id, e.title])), [facts, t])
  const legend = useMemo(() => legendItems(facts, t), [facts, t])

  const disableAnimation = rows.length > 100
  const limitLine = limit === 'none' ? null : LIMIT_VALUES[limit]

  return (
    <section className={styles.chartContainer} aria-labelledby={titleId}>
      <div className={styles.chartHeader}>
        <h3 className={styles.chartTitle} id={titleId}>{t('tokenBudget.contextGrowth.title')}</h3>
        <div className={styles.limitToggle} role="group" aria-label={t('tokenBudget.chart.limitLabel')}>
          {(['none', '200k', '1m'] as const).map(id => (
            <button
              key={id}
              type="button"
              className={`${styles.limitButton} ${id === limit ? styles.limitActive : ''}`}
              aria-pressed={id === limit}
              onClick={() => setLimit(id)}
            >
              {id === 'none' ? t('tokenBudget.chart.limit.none') : LIMIT_VALUES[id].label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={rows} margin={{ top: 22, right: 28, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
          <XAxis
            dataKey="call"
            type="number"
            domain={['dataMin', 'dataMax']}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatTokens}
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip content={props => <ChartTooltip {...props} titles={titles} t={t} />} />
          {limitLine && (
            <ReferenceLine
              y={limitLine.value}
              // 把 Y 軸撐到上限，才看得出用了幾成；預設的 discard 在上限高於資料時整條不畫
              ifOverflow="extendDomain"
              stroke="var(--color-error)"
              strokeDasharray="6 4"
              label={{ value: limitLine.label, position: 'right', fill: 'var(--color-error)', fontSize: 11 }}
            />
          )}
          {markers.compactions.map(c => (
            <ReferenceLine
              key={c.id}
              // 壓縮發生在第 call − 1 與第 call 次呼叫之間
              x={c.call - 0.5}
              stroke="var(--color-text-secondary)"
              strokeDasharray={markers.faintCompactions ? undefined : '4 3'}
              strokeOpacity={markers.faintCompactions ? 0.35 : 0.6}
              label={markers.compactionIcons ? { position: 'top', content: <ChartEventIcon kind="compaction" /> } : undefined}
            />
          ))}
          <Area
            type="monotone"
            dataKey="context"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            fill="var(--color-accent)"
            fillOpacity={0.16}
            isAnimationActive={!disableAnimation}
          />
          {markers.breaks.map(b => (
            <ReferenceDot
              key={b.id}
              x={b.call}
              y={rows[b.call - 1].context}
              r={4}
              fill={b.kind === 'unknown' ? MARKER_COLORS.info : MARKER_COLORS.warning}
              stroke="var(--color-bg)"
              label={{ position: 'top', content: <ChartEventIcon kind={b.kind} /> }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <ul className={styles.chartLegend}>
        {legend.map(item => (
          <li key={item.id}>
            <LegendMark id={item.id} faintCompactions={markers.faintCompactions} />
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
