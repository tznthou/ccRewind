import type { DistributionItem } from '../../../shared/types'
import DistributionPieChart from './DistributionPieChart'

const TAG_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#0891b2', '#64748b']

interface Props {
  data: DistributionItem[]
}

export default function TagDistribution({ data }: Props) {
  return <DistributionPieChart data={data} emptyText="No tag data" unitLabel="sessions" colors={TAG_COLORS} />
}
