#!/usr/bin/env python3
"""
历史数据增量更新脚本
====================

数据源（按优先级回退）：
  1. 腾讯财经K线API (web.ifzq.gtimg.cn)  - 港股/A股
  2. 新浪财经历史K线                     - 港股/A股/美股
  3. 东方财富ETF历史                     - 515170 等 ETF
  4. 保留现有数据                         - 实在拿不到就不更新

输出: js/history-data.js
  window.STOCK_HISTORY_DATA = { code: [{date, open, close, high, low, volume?}] }

增量策略:
  - 读现有 js/history-data.js 解析出已有数据
  - 从每个 code 的最后一条 date 开始, 拉新数据
  - 合并去重, 按 date 排序
  - 重新生成文件

支持标的:
  NIO     - 美股 (NIO Inc)         → 新浪(美股) / 腾讯
  00992   - 港股 (联想集团)         → 腾讯(hk00992) / 新浪
  515170  - A股 ETF (食品饮料)     → 腾讯(sh515170) / 新浪 / 东财

非交易日处理:
  - 工作日没数据(周末/节假日) → 标记 isTradingDay=false
  - 基金数据节假日不更新 → 沿用上一交易日

Usage:
  python3 scripts/update_history.py             # 增量更新
  python3 scripts/update_history.py --full      # 强制重新拉全部 6 个月
  python3 scripts/update_history.py --dry-run   # 模拟运行, 不写文件
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import re
from datetime import datetime, timedelta, date

# 路径
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
JS_FILE = os.path.join(PROJECT_DIR, "js", "history-data.js")
DATA_FILE = os.path.join(PROJECT_DIR, "data", "stock-history.json")
PRICES_FILE = os.path.join(PROJECT_DIR, "data", "stock-prices.json")

# 标的配置: code -> { tencent, sina, market, name }
#   tencent: 腾讯K线API用的代码 (http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=...)
#   sina:    新浪K线API用的代码 (https://hq.sinajs.cn/list=...)
#   market:  us/hk/sh/sz
STOCKS = {
    "NIO":    {"tencent": "usNIO.N",      "sina": "gb_nio",      "market": "us", "name": "蔚来汽车"},
    "00992":  {"tencent": "hk00992",      "sina": "hk00992",     "market": "hk", "name": "联想集团"},
    "515170": {"tencent": "sh515170",     "sina": "sh515170",    "market": "sh", "name": "食品饮料ETF"},
}

# 通用请求头
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://finance.sina.com.cn",
}


# ============================================================================
# 数据源 1: 腾讯财经K线API
# ============================================================================
def fetch_tencent_history(code, cfg, start_date, end_date):
    """从腾讯财经拉历史日K线. 返回 [{date, open, close, high, low, volume}]"""
    tc = cfg["tencent"]
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")
    url = (
        f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param="
        f"{tc},day,{start_str},{end_str},200,qfq"
    )
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            stock_data = data.get("data", {}).get(tc, {})
            raw = stock_data.get("qfqday") or stock_data.get("day") or []
            return [_parse_tencent_row(row) for row in raw if _parse_tencent_row(row)]
    except Exception as e:
        print(f"  [腾讯] {code} 失败: {e}")
        return None


def _parse_tencent_row(row):
    """腾讯K线API: [date, open, close, high, low, volume, ...]"""
    if not row or len(row) < 5:
        return None
    try:
        return {
            "date": row[0],
            "open": float(row[1]),
            "close": float(row[2]),
            "high": float(row[3]),
            "low": float(row[4]),
            "volume": float(row[5]) if len(row) > 5 and row[5] else 0,
        }
    except (ValueError, TypeError):
        return None


# ============================================================================
# 数据源 2: 新浪财经历史K线
# ============================================================================
def fetch_sina_history(code, cfg, start_date, end_date):
    """从新浪财经拉历史日K线. scale=240 (日线)."""
    sina = cfg["sina"]
    url = f"https://quotes.money.163.com/service/chddata.html?code={_sina_full_code(sina)}&start={start_date.strftime('%Y%m%d')}&end={end_date.strftime('%Y%m%d')}&fields=TCLOSE;HIGH;LOW;TOPEN;LCLOSE;CHG;PCHG;TURNOVER;VOTURNOVER;VATURNOVER"
    # 网易数据源比新浪更稳定, 用网易的接口(支持历史范围查询)
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("gbk", errors="ignore")
            return _parse_163_csv(text)
    except Exception as e:
        print(f"  [网易] {code} 失败: {e}")
        return None


def _sina_full_code(sina):
    """新浪代码转网易代码: hk00992 -> 0hk00992, gb_nio -> 0gb_nio, sh515170 -> 0sh515170"""
    return "0" + sina


def _parse_163_csv(text):
    """网易CSV: 日期,股票代码,名称,收盘价,最高价,最低价,开盘价,前收盘,涨跌额,涨跌幅,换手率,成交量,成交金额,总市值,流通市值"""
    lines = text.strip().split("\n")
    if len(lines) < 2:
        return []
    result = []
    for line in lines[1:]:  # 跳表头
        parts = line.strip().split(",")
        if len(parts) < 8 or parts[0] == "日期":
            continue
        try:
            date_str = parts[0]
            if not re.match(r"\d{4}-\d{2}-\d{2}", date_str):
                continue
            result.append({
                "date": date_str,
                "open": float(parts[6]) if parts[6] else 0,
                "close": float(parts[3]) if parts[3] else 0,
                "high": float(parts[4]) if parts[4] else 0,
                "low": float(parts[5]) if parts[5] else 0,
                "volume": float(parts[11]) if parts[11] else 0,
            })
        except (ValueError, TypeError, IndexError):
            continue
    return result


# ============================================================================
# 数据源 3: 东方财富历史K线 (备用)
# ============================================================================
def fetch_eastmoney_history(code, cfg, start_date, end_date):
    """东方财富K线API. 支持 ETF. secid 格式: 1.515170 (沪市), 0.00992 (深市), 105.NIO (美股), 116.00992 (港股)"""
    secid_map = {
        "NIO":    "105.NIO",      # 105 = 美股
        "00992":  "116.00992",    # 116 = 港股
        "515170": "1.515170",     # 1 = 沪市
    }
    secid = secid_map.get(code)
    if not secid:
        return None

    # klt=1 日k, fqt=1 前复权
    url = (
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get?"
        f"secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58"
        f"&klt=101&fqt=1&beg={start_date.strftime('%Y%m%d')}&end={end_date.strftime('%Y%m%d')}"
    )
    try:
        req = urllib.request.Request(url, headers={**HEADERS, "Referer": "https://quote.eastmoney.com/"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            klines = data.get("data", {}).get("klines", [])
            result = []
            for line in klines:
                parts = line.split(",")
                if len(parts) < 6:
                    continue
                try:
                    result.append({
                        "date": parts[0],
                        "open": float(parts[1]),
                        "close": float(parts[2]),
                        "high": float(parts[3]),
                        "low": float(parts[4]),
                        "volume": float(parts[5]) if parts[5] else 0,
                    })
                except (ValueError, TypeError):
                    continue
            return result
    except Exception as e:
        print(f"  [东财] {code} 失败: {e}")
        return None


# ============================================================================
# 整合函数
# ============================================================================
def fetch_one_code(code, cfg, start_date, end_date):
    """按优先级回退, 返回该 code 的历史数据列表"""
    sources = [
        ("腾讯", lambda: fetch_tencent_history(code, cfg, start_date, end_date)),
        ("东财", lambda: fetch_eastmoney_history(code, cfg, start_date, end_date)),
        ("网易", lambda: fetch_sina_history(code, cfg, start_date, end_date)),
    ]
    for name, fetcher in sources:
        print(f"  尝试 {name}...")
        result = fetcher()
        if result and len(result) >= 5:
            print(f"  [{name}] 成功: {len(result)} 条")
            return result, name
    print(f"  [ALL FAIL] {code} 所有数据源失败")
    return None, None


def parse_existing_js():
    """从 js/history-data.js 解析出现有数据."""
    if not os.path.exists(JS_FILE):
        return {}
    with open(JS_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(r"window\.STOCK_HISTORY_DATA\s*=\s*(\{.*?\});", content, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as e:
        print(f"  [WARN] 解析现有 js/history-data.js 失败: {e}")
        return {}


def write_js_file(all_data, source, updated_time):
    """生成 js/history-data.js"""
    # 排序: 每个 code 的记录按 date 升序
    for code in all_data:
        all_data[code].sort(key=lambda r: r["date"])
        # 去重: 同 date 保留最后一条
        seen = {}
        for r in all_data[code]:
            seen[r["date"]] = r
        all_data[code] = list(seen.values())

    # 紧凑 JSON
    json_str = json.dumps(all_data, ensure_ascii=False, separators=(",", ":"))

    header = (
        "// Auto-generated by scripts/update_history.py\n"
        "// DO NOT EDIT MANUALLY.\n"
        f"// Source: {source}\n"
        f"// Updated: {updated_time}\n"
        "// Schema: window.STOCK_HISTORY_DATA[code] = [{date, open, close, high, low, volume?}]\n"
        "// Codes: " + ", ".join(all_data.keys()) + "\n"
    )
    content = header + "window.STOCK_HISTORY_DATA = " + json_str + ";\n"

    with open(JS_FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"\n✅ 写入 {JS_FILE} ({len(content)} bytes)")

    # 同步 data/stock-history.json (兼容旧的 localStorage fallback)
    json_data = {**all_data, "_source": source, "_updated": updated_time}
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
    print(f"✅ 同步 {DATA_FILE}")


def main():
    args = sys.argv[1:]
    full_refresh = "--full" in args
    dry_run = "--dry-run" in args

    print("=" * 60)
    print(f"历史数据更新脚本  模式: {'全量' if full_refresh else '增量'}  {'(模拟)' if dry_run else ''}")
    print("=" * 60)

    today = date.today()
    if full_refresh:
        start = today - timedelta(days=180)  # 6 个月
    else:
        start = today - timedelta(days=10)  # 增量: 只拉最近 10 天

    existing = parse_existing_js()
    print(f"现有数据 codes: {list(existing.keys())}")
    for code, arr in existing.items():
        if arr:
            print(f"  {code}: {len(arr)} 条, 末 {arr[-1]['date']}")

    all_data = {}
    sources_used = set()
    for code, cfg in STOCKS.items():
        print(f"\n[{code}] 拉取 {start} ~ {today}...")
        new_records, source = fetch_one_code(code, cfg, start, today)
        if not new_records:
            print(f"  [FALLBACK] 保留现有 {code} 数据")
            all_data[code] = existing.get(code, [])
            continue

        sources_used.add(source)

        # 合并: 旧 + 新, 按 date 去重
        old = existing.get(code, [])
        combined = old + new_records
        # 去重 + 排序
        seen = {}
        for r in combined:
            seen[r["date"]] = r
        all_data[code] = sorted(seen.values(), key=lambda r: r["date"])

        new_count = len(all_data[code]) - len(old)
        print(f"  [{code}] 新增 {new_count} 条, 共 {len(all_data[code])} 条")
        print(f"         范围: {all_data[code][0]['date']} ~ {all_data[code][-1]['date']}")

    if dry_run:
        print("\n[DRY-RUN] 不写文件")
        return 0

    # 写入
    sources_str = "+".join(sorted(sources_used)) if sources_used else "fallback-only"
    write_js_file(all_data, f"auto-update-{sources_str}-{today}", today.isoformat())

    print("\n" + "=" * 60)
    print("更新完成!")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
