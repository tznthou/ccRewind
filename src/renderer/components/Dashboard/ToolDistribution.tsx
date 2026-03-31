import type { DistributionItem } from '../../../shared/types'
import DistributionPieChart from './DistributionPieChart'

interface Props {
  data: DistributionItem[]
}

export default function ToolDistribution({ data }: Props) {
  return <DistributionPieChart data={data} emptyText="No tool data" unitLabel="uses" />
}
