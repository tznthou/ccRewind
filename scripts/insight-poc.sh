#!/usr/bin/env bash
set -euo pipefail

DB="$HOME/.ccrewind/index.db"

if [ ! -f "$DB" ]; then
  echo "DB not found: $DB"
  exit 1
fi

run_query() {
  local title=$1
  local sql=$2
  echo ""
  echo "## $title"
  echo ""
  sqlite3 -readonly -cmd ".mode markdown" "$DB" "$sql"
}

echo "# ccRewind 降智代理指標 POC"
echo ""
echo "- DB: \`$DB\`"
echo "- 生成時間: $(date '+%Y-%m-%d %H:%M:%S')"

run_query "Q1: 重複編輯偵測 — 同 session 同檔 edit/write count ≥ 5 (top 20)" "
SELECT
  substr(COALESCE(s.title, s.id), 1, 35) AS session,
  substr(sf.file_path, -45) AS file,
  sf.operation AS op,
  sf.count
FROM session_files sf
JOIN sessions s ON sf.session_id = s.id
WHERE sf.operation IN ('edit', 'write')
  AND sf.count >= 5
ORDER BY sf.count DESC
LIMIT 20;
"

run_query "Q2: Model 層級 token 行為 (messages, 過濾合成/未知 model)" "
SELECT
  model,
  COUNT(*) AS msgs,
  ROUND(AVG(input_tokens), 0) AS avg_in,
  ROUND(AVG(output_tokens), 0) AS avg_out,
  MAX(output_tokens) AS max_out,
  ROUND(AVG(CASE WHEN has_tool_use = 1 THEN 1.0 ELSE 0 END) * 100, 1) AS tool_use_pct
FROM messages
WHERE model IS NOT NULL
  AND model NOT LIKE '<%'
  AND role = 'assistant'
GROUP BY model
ORDER BY msgs DESC;
"

run_query "Q3: outcome_status 分佈 — turn 數 + 耗時 + 產出 token" "
SELECT
  COALESCE(NULLIF(outcome_status, ''), '(null)') AS outcome,
  COUNT(*) AS sessions,
  ROUND(AVG(message_count), 0) AS avg_turns,
  ROUND(AVG(duration_seconds) / 60.0, 1) AS avg_dur_min,
  ROUND(AVG(total_output_tokens), 0) AS avg_out_tok
FROM sessions
GROUP BY outcome_status
ORDER BY sessions DESC;
"

run_query "Q4: Output token 離群 — 各 tool 分組下的 top 1 (整體 top 10)" "
WITH ranked AS (
  SELECT
    model,
    COALESCE(NULLIF(tool_names, ''), '(none)') AS tool,
    output_tokens,
    session_id,
    ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(tool_names, ''), '(none)') ORDER BY output_tokens DESC) AS rn
  FROM messages
  WHERE output_tokens > 0 AND model IS NOT NULL
)
SELECT
  tool,
  model,
  output_tokens AS max_out
FROM ranked
WHERE rn = 1
ORDER BY output_tokens DESC
LIMIT 10;
"

run_query "Q5: 週趨勢 — committed rate、avg turns、avg output tokens (最近 12 週)" "
SELECT
  strftime('%Y-W%W', started_at) AS week,
  COUNT(*) AS sessions,
  ROUND(SUM(CASE WHEN outcome_status = 'committed' THEN 1.0 ELSE 0 END) * 100.0 / COUNT(*), 1) AS commit_pct,
  ROUND(AVG(message_count), 0) AS avg_turns,
  ROUND(AVG(total_output_tokens), 0) AS avg_out_tok
FROM sessions
WHERE started_at IS NOT NULL
GROUP BY week
ORDER BY week DESC
LIMIT 12;
"

run_query "Q6: Model × outcome 交叉 — 主要 model 的 commit 率差異" "
WITH session_model AS (
  SELECT
    session_id,
    model,
    COUNT(*) AS n,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY COUNT(*) DESC) AS rn
  FROM messages
  WHERE model IS NOT NULL AND model NOT LIKE '<%' AND role = 'assistant'
  GROUP BY session_id, model
),
dominant AS (
  SELECT session_id, model FROM session_model WHERE rn = 1
)
SELECT
  d.model,
  COUNT(*) AS sessions,
  ROUND(SUM(CASE WHEN s.outcome_status = 'committed' THEN 1.0 ELSE 0 END) * 100.0 / COUNT(*), 1) AS commit_pct,
  ROUND(AVG(s.message_count), 0) AS avg_turns,
  ROUND(AVG(s.duration_seconds) / 60.0, 1) AS avg_dur_min
FROM dominant d
JOIN sessions s ON d.session_id = s.id
GROUP BY d.model
HAVING COUNT(*) >= 20
ORDER BY sessions DESC;
"
