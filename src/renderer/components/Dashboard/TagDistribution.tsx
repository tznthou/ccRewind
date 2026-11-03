import type { DistributionItem } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import DistributionPieChart from './DistributionPieChart'

/** 圓餅的同一組 8 色換個順序：綠、藍、橘、紅、紫、粉紅、青、灰 */
const TAG_COLORS = [
  'var(--chart-cat-3)',
  'var(--chart-cat-1)',
  'var(--chart-cat-4)',
  'var(--chart-cat-5)',
  'var(--chart-cat-6)',
  'var(--chart-cat-7)',
  'var(--chart-cat-2)',
  'var(--chart-cat-8)',
]

interface Props {
  data: DistributionItem[]
}

export default function TagDistribution({ data }: Props) {
  const { t } = useI18n()
  return (
    <DistributionPieChart
      data={data}
      emptyText={t('dashboard.tags.empty')}
      unitLabel={t('dashboard.distribution.sessionsUnit')}
      ariaLabel={t('dashboard.aria.tagPie')}
      colors={TAG_COLORS}
    />
  )
}
