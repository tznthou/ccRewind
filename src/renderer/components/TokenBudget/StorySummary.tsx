import { Fragment, useMemo } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { numberCards, storyParts, type SessionFacts } from './sessionStory'
import styles from './TokenBudget.module.css'

interface Props {
  facts: SessionFacts
}

/** 一句話講完這場 ＋ 五張數字卡 */
export default function StorySummary({ facts }: Props) {
  const { t } = useI18n()
  const parts = useMemo(() => storyParts(facts, t), [facts, t])
  const cards = useMemo(() => numberCards(facts, t), [facts, t])

  return (
    <section aria-label={t('tokenBudget.story.label')}>
      <p className={styles.storyText}>
        {parts.map((part, i) => (part.strong
          ? <strong key={i}>{part.text}</strong>
          : <Fragment key={i}>{part.text}</Fragment>))}
      </p>
      <dl className={styles.cards}>
        {cards.map(card => (
          <div key={card.id} className={styles.card}>
            <dt className={styles.cardLabel}>{card.label}</dt>
            <dd className={styles.cardValue}>{card.value}</dd>
            {card.sub && <dd className={styles.cardSub}>{card.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  )
}
