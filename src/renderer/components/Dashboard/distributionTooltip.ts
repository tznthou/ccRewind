/**
 * 分布圓餅 tooltip 的 [數值, 名稱]：名稱是類別（工具或標籤），單位接在數量後面。
 * tooltip 的字一律是主題文字色（CHART_TOOLTIP_ITEM_STYLE），看不出是哪一塊的顏色，只能靠名稱分辨
 */
export function formatDistributionTooltip(value: unknown, name: unknown, unitLabel: string): [string, string] {
  return [`${Number(value).toLocaleString()} ${unitLabel}`, String(name)]
}
