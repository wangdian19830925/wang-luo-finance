#!/bin/bash
set -e

# Deploy to GitHub Pages using REST API (bypasses git push network restrictions)
# Usage: GITHUB_TOKEN=xxx ./deploy.sh "vXX: description"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN environment variable not set"
  echo "Usage: GITHUB_TOKEN=xxx ./deploy.sh \"v102: 描述\""
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: GITHUB_TOKEN=xxx ./deploy.sh \"vXX: description\""
  exit 1
fi

MSG="$1"

echo "=== 本地提交 ==="
git add -A
git commit -m "$MSG" || echo "Nothing to commit"

echo "=== 通过 GitHub API 推送 ==="
python3 scripts/deploy_github_api.py "$MSG"

echo "=== 同步本地 git 历史 ==="
git fetch origin || echo "git fetch failed, please sync manually later"
git reset --hard origin/main || echo "git reset failed, please sync manually later"

echo "=== 完成 ==="
