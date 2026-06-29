#!/usr/bin/env python3
"""
Deploy local files to GitHub Pages via GitHub REST API (Git Data API).
Uses only Python stdlib (urllib, json, os, base64, sys).

Usage:
    GITHUB_TOKEN=xxx python3 scripts/deploy_github_api.py "commit message"

Requires:
    - GITHUB_TOKEN environment variable with repo scope
    - REPO_OWNER/REPO_NAME default: wangdian19830925/wang-luo-finance
"""
import os
import sys
import json
import base64
import urllib.request
import urllib.parse
import urllib.error

REPO_OWNER = os.environ.get("GITHUB_OWNER", "wangdian19830925")
REPO_NAME = os.environ.get("GITHUB_REPO", "wang-luo-finance")
BRANCH = os.environ.get("GITHUB_BRANCH", "main")
TOKEN = os.environ.get("GITHUB_TOKEN", "")

BASE_URL = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}"


def api_request(method, path, payload=None, expect_ok=True):
    """Make a GitHub API request."""
    url = BASE_URL + path
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    if data is not None:
        req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        if not expect_ok:
            return e.code, json.loads(body) if body else {}
        print(f"GitHub API error: {method} {url}")
        print(f"Status: {e.code}")
        print(f"Response: {body}")
        sys.exit(1)


def get_file_sha(path):
    """Get current SHA of a file on the target branch. Returns None if not found."""
    encoded_path = urllib.parse.quote(path, safe='/')
    status, body = api_request("GET", f"/contents/{encoded_path}?ref={BRANCH}", expect_ok=False)
    if status == 200:
        return body.get("sha")
    return None


def read_local_file(path):
    """Read local file content and return (content_base64, sha256_placeholder)."""
    with open(path, "rb") as f:
        raw = f.read()
    return base64.b64encode(raw).decode("utf-8")


def main():
    if not TOKEN:
        print("ERROR: GITHUB_TOKEN environment variable not set")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: python3 scripts/deploy_github_api.py \"commit message\"")
        sys.exit(1)

    message = sys.argv[1]

    # Files to deploy: (local_path, repo_path, executable)
    files_to_deploy = [
        (".nojekyll", ".nojekyll", False),
        ("index.html", "index.html", False),
        ("manifest.json", "manifest.json", False),
        ("css/style.css", "css/style.css", False),
        ("js/app.js", "js/app.js", False),
        ("js/storage.js", "js/storage.js", False),
        ("js/parser.js", "js/parser.js", False),
        ("js/insurance-data.js", "js/insurance-data.js", False),
        ("js/stock-data.js", "js/stock-data.js", False),
        ("js/rsu-data.js", "js/rsu-data.js", False),
        ("js/fund-data.js", "js/fund-data.js", False),
        ("js/loan-data.js", "js/loan-data.js", False),
        ("js/annuity-data.js", "js/annuity-data.js", False),
        ("js/history-data.js", "js/history-data.js", False),
        ("service-worker.js", "service-worker.js", False),
        ("deploy.sh", "deploy.sh", True),
        ("scripts/deploy_github_api.py", "scripts/deploy_github_api.py", True),
        ("scripts/fetch_stock_prices.py", "scripts/fetch_stock_prices.py", True),
        ("scripts/update_history.py", "scripts/update_history.py", True),
        ("scripts/update_macro_trends.py", "scripts/update_macro_trends.py", True),
        ("scripts/generate_calendar.py", "scripts/generate_calendar.py", True),
        ("data/stock-prices.json", "data/stock-prices.json", False),
        ("data/macro-trends.json", "data/macro-trends.json", False),
        ("docs/功能点checklist.md", "docs/功能点checklist.md", False),
        ("docs/测试报告-v94.md", "docs/测试报告-v94.md", False),
        ("docs/测试报告-v95.md", "docs/测试报告-v95.md", False),
        ("docs/测试报告-v96.md", "docs/测试报告-v96.md", False),
        ("docs/测试报告-v97.md", "docs/测试报告-v97.md", False),
        ("docs/测试报告-v98.md", "docs/测试报告-v98.md", False),
        ("docs/测试报告-v99.md", "docs/测试报告-v99.md", False),
        ("docs/测试报告-v100.md", "docs/测试报告-v100.md", False),
        ("docs/测试报告-v101.md", "docs/测试报告-v101.md", False),
        ("docs/测试报告-v102.md", "docs/测试报告-v102.md", False),
        ("docs/测试报告-v104.md", "docs/测试报告-v104.md", False),
        ("docs/测试报告-v105.md", "docs/测试报告-v105.md", False),
        ("docs/测试报告-v106.md", "docs/测试报告-v106.md", False),
        ("docs/测试报告-v107.md", "docs/测试报告-v107.md", False),
        ("docs/测试报告-v121.md", "docs/测试报告-v121.md", False),
        ("docs/测试报告-v122.md", "docs/测试报告-v122.md", False),
        ("docs/测试报告-v123.md", "docs/测试报告-v123.md", False),
        ("docs/测试报告-v124.md", "docs/测试报告-v124.md", False),
        ("docs/测试报告-v145.md", "docs/测试报告-v145.md", False),
        ("docs/测试报告-v146.md", "docs/测试报告-v146.md", False),
        ("docs/测试报告-v147.md", "docs/测试报告-v147.md", False),
        ("docs/测试报告-v148.md", "docs/测试报告-v148.md", False),
        ("docs/测试报告-v149.md", "docs/测试报告-v149.md", False),
        ("docs/测试报告-v150.md", "docs/测试报告-v150.md", False),
        ("docs/测试报告-v151.md", "docs/测试报告-v151.md", False),
        ("docs/测试报告-v152.md", "docs/测试报告-v152.md", False),
        ("docs/测试报告-v153.md", "docs/测试报告-v153.md", False),
        ("docs/测试报告-v154.md", "docs/测试报告-v154.md", False),
        ("docs/测试报告-v155.md", "docs/测试报告-v155.md", False),
        ("docs/测试报告-v156.md", "docs/测试报告-v156.md", False),
        ("docs/测试报告-v157.md", "docs/测试报告-v157.md", False),
        ("docs/测试报告-v158.md", "docs/测试报告-v158.md", False),
        ("docs/测试报告-v159.md", "docs/测试报告-v159.md", False),
        ("docs/测试报告-v160.md", "docs/测试报告-v160.md", False),
        ("docs/macro-trends-design.md", "docs/macro-trends-design.md", False),
        ("tests/loan_calc_tests.js", "tests/loan_calc_tests.js", False),
        ("tests/loan_chart_tests.js", "tests/loan_chart_tests.js", False),
        ("tests/retirement_curve_tests.js", "tests/retirement_curve_tests.js", False),
        ("tests/run_tests.js", "tests/run_tests.js", False),
        ("tests/integration_tests.js", "tests/integration_tests.js", False),
        ("tests/smoke_test.js", "tests/smoke_test.js", False),
    ]

    # Build current tree
    tree_items = []
    for local_path, repo_path, executable in files_to_deploy:
        if not os.path.exists(local_path):
            print(f"Warning: local file not found, skipping: {local_path}")
            continue
        content_b64 = read_local_file(local_path)
        tree_items.append({
            "path": repo_path,
            "mode": "100755" if executable else "100644",
            "type": "blob",
            "content": base64.b64decode(content_b64).decode("utf-8"),
        })

    # Get current commit SHA
    status, ref_body = api_request("GET", f"/git/ref/heads/{BRANCH}")
    current_commit_sha = ref_body["object"]["sha"]

    # Create tree
    status, tree_body = api_request("POST", "/git/trees", {
        "base_tree": current_commit_sha,
        "tree": tree_items
    })
    new_tree_sha = tree_body["sha"]

    # Create commit
    status, commit_body = api_request("POST", "/git/commits", {
        "message": message,
        "tree": new_tree_sha,
        "parents": [current_commit_sha]
    })
    new_commit_sha = commit_body["sha"]

    # Update branch ref
    # GitHub API: GET uses /git/ref/, PATCH uses /git/refs/
    api_request("PATCH", f"/git/refs/heads/{BRANCH}", {
        "sha": new_commit_sha
    })

    print(f"Deployed to {REPO_OWNER}/{REPO_NAME}@{BRANCH}: {new_commit_sha}")


if __name__ == "__main__":
    main()
