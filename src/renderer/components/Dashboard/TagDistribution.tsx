import type { DistributionItem } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import DistributionPieChart from './DistributionPieChart'

const TAG_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#0891b2', '#64748b']

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
