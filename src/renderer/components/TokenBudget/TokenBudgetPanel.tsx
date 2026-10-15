import { useCallback, useId, useMemo, useState } from 'react'
import type { SessionTokenStats } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import TokenSummaryCard from './TokenSummaryCard'
import ContextGrowthChart from './ContextGrowthChart'
import TokenBreakdown from './TokenBreakdown'
import CostHeatBar from './CostHeatBar'
import InsightsPanel from './InsightsPanel'
import StorySummary from './StorySummary'
import {
  adviceItems, buildSessionFacts, eventItems, eventListText, eventSummaryRows, eventsNeedSummary, type SessionFacts,
} from './sessionStory'
import styles from './TokenBudget.module.css'

interface Props {
  sessionId: string
}

function StoryPanels({ stats, facts }: { stats: SessionTokenStats; facts: SessionFacts }) {
  const { t } = useI18n()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()

  const events = useMemo(() => eventItems(facts, t), [facts, t])
  const eventText = useMemo(() => eventListText(facts, t), [facts, t])
  const summary = useMemo(() => (eventsNeedSummary(facts)
    ? { rows: eventSummaryRows(facts, t), expandLabel: eventText.expand, collapseLabel: eventText.collapse }
    : null), [facts, t, eventText])
  const advice = useMemo(() => adviceItems(facts, t), [facts, t])

  return (
    <>
      <StorySummary facts={facts} />
      <ContextGrowthChart stats={stats} facts={facts} />
      <InsightsPanel
        title={eventText.title}
        subtitle={eventText.subtitle}
        items={events}
        emptyText={eventText.empty}
        summary={summary}
      />
      <InsightsPanel
        title={t('tokenBudget.advice.title')}
        items={advice}
        emptyText={t('tokenBudget.advice.empty')}
        prominentDetail
      />
      <div>
        <button
          type="button"
          className={styles.detailsToggle}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen(prev => !prev)}
        >
          <span className={styles.detailsChevron} aria-hidden="true">▸</span>
          {t('tokenBudget.details.toggle')}
          <small className={styles.detailsHint}>{t('tokenBudget.details.hint')}</small>
        </button>
        <div id={detailsId} className={styles.details} hidden={!detailsOpen}>
          {detailsOpen && (
            <>
              <TokenSummaryCard stats={stats} />
              <div className={styles.detailsRow}>
                <TokenBreakdown stats={stats} />
                <CostHeatBar turns={stats.turns} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function TokenBudgetInner({ sessionId }: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [stats, setStats] = useState<SessionTokenStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleToggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      if (next && !stats && !error) {
        setLoading(true)
        window.api.getSessionTokenStats(sessionId)
          .then(setStats)
          .catch((e: unknown) => {
            if (import.meta.env.DEV) {
              console.error('[TokenBudgetPanel] getSessionTokenStats failed:', e)
            }
            setError(t('tokenBudget.error.loadFailed'))
          })
          .finally(() => setLoading(false))
      }
      return next
    })
  }, [sessionId, stats, error, t])

  // 故事、圖、清單、建議共用同一份 facts；只在換資料時重算，切語言只重組文字
  const facts = useMemo(() => (stats ? buildSessionFacts(stats) : null), [stats])

  return (
    <div className={styles.panel}>
      <button
        className={styles.toggleButton}
        onClick={handleToggle}
      >
        {expanded ? t('tokenBudget.toggle.hide') : t('tokenBudget.toggle.show')}
      </button>

      {expanded && (
        <div className={styles.panelContent}>
          {loading && <div className={styles.loading}>{t('tokenBudget.loading')}</div>}
          {!loading && error && (
            <div className={styles.error}>{error}</div>
          )}
          {!loading && !error && stats && stats.turns.length === 0 && (
            <div className={styles.empty}>{t('tokenBudget.empty')}</div>
          )}
          {!loading && !error && stats && facts && stats.turns.length > 0 && (
            <StoryPanels stats={stats} facts={facts} />
          )}
        </div>
      )}
    </div>
  )
}

export default function TokenBudgetPanel({ sessionId }: Props) {
  return <TokenBudgetInner key={sessionId} sessionId={sessionId} />
}
