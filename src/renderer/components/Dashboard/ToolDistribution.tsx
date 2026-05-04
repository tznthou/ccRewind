import type { DistributionItem } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import DistributionPieChart from './DistributionPieChart'

interface Props {
  data: DistributionItem[]
}

export default function ToolDistribution({ data }: Props) {
  const { t } = useI18n()
  return (
    <DistributionPieChart
      data={data}
      emptyText={t('dashboard.toolUsage.empty')}
      unitLabel={t('dashboard.distribution.uses')}
      ariaLabel={t('dashboard.aria.toolPie')}
    />
  )
}
