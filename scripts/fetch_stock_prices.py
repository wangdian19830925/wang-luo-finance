#!/usr/bin/env python3
"""
股票价格 + 汇率获取脚本
获取港股/美股实时价格和汇率，保存到 data/stock-prices.json
数据源: Yahoo Finance → Sina(备用) → 腾讯(备用)
汇率: exchangerate-api.com → Yahoo Finance(备用)
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "data")
OUTPUT_FILE = os.path.join(DATA_DIR, "stock-prices.json")

# 股票代码映射
STOCKS = {
    "00992":  {"yahoo": "0992.HK", "sina": "hk00992",    "market": "HK"},
    "NIO":    {"yahoo": "NIO",     "sina": "gb_nio",     "market": "US"},
    "689009": {"yahoo": "689009.SS","sina": "sh689009",   "market": "CN"},
}

# 基金代码映射（天天基金网 API）
FUNDS = {
    "013126": {"name": "华夏食品饮料ETF发起联接C"},
}

YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_yahoo(symbol):
    """从 Yahoo Finance 获取股价"""
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
    req = urllib.request.Request(url, headers=YAHOO_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            result = data["chart"]["result"][0]
            meta = result["meta"]
            return {
                "price": meta.get("regularMarketPrice"),
                "previousClose": meta.get("previousClose"),
                "currency": meta.get("currency", ""),
                "name": meta.get("longName", ""),
                "timestamp": meta.get("regularMarketTime"),
                "source": "yahoo"
            }
    except Exception as e:
        return {"error": str(e), "source": "yahoo"}


def fetch_sina(sina_code):
    """从新浪财经获取股价"""
    url = f"https://hq.sinajs.cn/list={sina_code}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://finance.sina.com.cn"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode("gbk")
            parts = text.split('"')[1].split(",")
            if len(parts) < 2:
                return {"error": "Invalid response", "source": "sina"}

            name = parts[0]

            # 港股格式(hk): "名称,开盘,昨收,最高,最低,最新价,..."
            # 美股格式(gb_): "名称,当前价,..."
            # A股格式(sh/sz): "名称,今开,昨收,当前价,最高,最低,..."
            if sina_code.startswith("hk"):
                # 港股: 索引6是当前价
                if len(parts) > 6:
                    return {
                        "price": float(parts[6]) if parts[6] else None,
                        "currency": "HKD",
                        "name": name,
                        "source": "sina"
                    }
            elif sina_code.startswith("sh") or sina_code.startswith("sz"):
                # A股: 索引3是当前价
                if len(parts) > 3:
                    return {
                        "price": float(parts[3]) if parts[3] else None,
                        "currency": "CNY",
                        "name": name,
                        "source": "sina"
                    }
            else:
                # 美股: 索引1是当前价
                if len(parts) > 1:
                    return {
                        "price": float(parts[1]) if parts[1] else None,
                        "currency": "USD",
                        "name": name,
                        "source": "sina"
                    }
    except Exception as e:
        return {"error": str(e), "source": "sina"}
    return {"error": "Parse failed", "source": "sina"}


def fetch_fx_rates():
    """从 exchangerate-api.com 获取汇率（免费，无需 API key）"""
    url = "https://open.er-api.com/v6/latest/USD"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            rates = data.get("rates", {})
            cny_rate = rates.get("CNY")
            hkd_rate = rates.get("HKD")
            if cny_rate and hkd_rate:
                # USDCNY = CNY per USD, HKDC NY = CNY per HKD = (CNY/USD) / (HKD/USD)
                usdcny = cny_rate
                hkdcny = cny_rate / hkd_rate if hkd_rate else None
                return {
                    "USDCNY": {"rate": round(usdcny, 4), "source": "er-api"},
                    "HKDCNY": {"rate": round(hkdcny, 4) if hkdcny else None, "source": "er-api"}
                }
    except Exception as e:
        return {"error": str(e), "source": "er-api"}


def fetch_fx_yahoo(pair_code, symbol):
    """从 Yahoo Finance 获取汇率（备用）"""
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d"
    req = urllib.request.Request(url, headers=YAHOO_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            result = data["chart"]["result"][0]
            price = result["meta"].get("regularMarketPrice")
            if price:
                return {pair_code: {"rate": round(price, 4), "source": "yahoo"}}
    except Exception:
        pass
    return {}


def fetch_fund_nav(fund_code):
    """从天天基金网获取基金净值"""
    url = f"https://fundgz.1234567.com.cn/js/{fund_code}.js"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://fund.eastmoney.com/"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            # 响应格式: jsonpgz({...});
            start = raw.find("{")
            end = raw.rfind("}")
            if start == -1 or end == -1:
                return {"error": "Invalid response format", "source": "tiantian"}
            data = json.loads(raw[start:end+1])
            nav = float(data.get("dwjz", 0)) if data.get("dwjz") else None  # 单位净值
            est = float(data.get("gsz", 0)) if data.get("gsz") else None     # 估算净值
            return {
                "nav": nav,
                "estNav": est,
                "name": data.get("name", ""),
                "navDate": data.get("jzrq", ""),
                "estTime": data.get("gztime", ""),
                "source": "tiantian"
            }
    except Exception as e:
        return {"error": str(e), "source": "tiantian"}


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    fetch_time = time.strftime("%Y-%m-%d %H:%M:%S")

    # 1. 获取股票价格
    results = {}
    for code, cfg in STOCKS.items():
        print(f"正在获取 {code} ({cfg['yahoo']})...")
        result = fetch_yahoo(cfg["yahoo"])
        if result.get("error") or not result.get("price"):
            print(f"  Yahoo 失败: {result.get('error', '无数据')}, 尝试新浪...")
            result = fetch_sina(cfg["sina"])
        if result.get("error"):
            print(f"  所有数据源均失败: {result['error']}")
            result["price"] = None
        else:
            print(f"  当前价: {result.get('price')} {result.get('currency', '')}")
        results[code] = result

    # 2. 获取汇率
    fx_rates = fetch_fx_rates()
    if fx_rates.get("error") or not fx_rates.get("USDCNY", {}).get("rate"):
        print("  er-api 汇率失败，尝试 Yahoo...")
        fx_rates = {}
        for pair_code, symbol in [("USDCNY", "USDCNY=X"), ("HKDCNY", "HKDCNY=X")]:
            fx_rates.update(fetch_fx_yahoo(pair_code, symbol))

    for pair_code, info in fx_rates.items():
        if info.get("rate"):
            print(f"  汇率 {pair_code}: {info['rate']} ({info.get('source', '')})")
        else:
            print(f"  汇率 {pair_code}: 获取失败")

    # 3. 获取基金净值
    fund_results = {}
    for code, cfg in FUNDS.items():
        print(f"正在获取基金 {code} ({cfg['name']})...")
        result = fetch_fund_nav(code)
        if result.get("error"):
            print(f"  失败: {result['error']}")
        else:
            print(f"  净值: {result.get('nav')} (日期: {result.get('navDate')}), 估算: {result.get('estNav')} ({result.get('estTime')})")
        fund_results[code] = result

    output = {
        "fetchTime": fetch_time,
        "stocks": results,
        "funds": fund_results,
        "fxRates": fx_rates
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n结果已保存到: {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
