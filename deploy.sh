#!/bin/bash
set -e

# Deploy to GitHub Pages using REST API (bypasses git push network restrictions)
# Usage: GITHUB_TOKEN=xxx ./deploy.sh "v183: description"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN environment variable not set"
  echo "Usage: GITHUB_TOKEN=xxx ./deploy.sh \"v183: 描述\""
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: GITHUB_TOKEN=xxx ./deploy.sh \"v183: description\""
  exit 1
fi

MSG="$1"

echo "=== 本地提交 ==="
git add -A
git commit -m "$MSG" || echo "Nothing to commit"

echo "=== 通过 GitHub API 推送 ==="
python3 scripts/deploy_github_api.py "$MSG"

echo "=== 同步本地 git 历史 ==="
if git fetch origin; then
  git reset --hard origin/main
else
  echo "⚠️ git fetch failed, 手动对齐 origin/main 到本地提交"
  LOCAL_COMMIT=$(git rev-parse HEAD)
  git update-ref refs/remotes/origin/main "$LOCAL_COMMIT"
  echo "✅ origin/main 已对齐到 $LOCAL_COMMIT"
fi

echo "=== 完成 ==="
