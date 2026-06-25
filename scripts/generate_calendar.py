#!/usr/bin/env python3
"""
生成保险缴费 & 房贷还款 .ics 日历文件
数据来源: js/insurance-data.js, js/loan-data.js
"""
import json
import math
from datetime import datetime, date, timedelta
from pathlib import Path

# ── 等额本息月供计算 ──
def monthly_payment(principal, annual_rate, months):
    mr = annual_rate / 100 / 12
    if mr == 0:
        return principal / months
    factor = (1 + mr) ** months
    return round(principal * mr * factor / (factor - 1), 2)

# ── RRULE 文本 ──
def yearly_rrule(dt, until_date):
    """生成年度重复 RRULE，直到 until_date"""
    return f"FREQ=YEARLY;UNTIL={until_date.strftime('%Y%m%d')}T235959Z"

def monthly_rrule(dt, until_date):
    """生成月度重复 RRULE，直到 until_date"""
    return f"FREQ=MONTHLY;UNTIL={until_date.strftime('%Y%m%d')}T235959Z"

# ── ICS 模板 ──
ICS_HEADER = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//FamilyFinance//InsuranceLoanCalendar//CN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:家庭资产 · 缴费还款提醒
X-WR-CALDESC:保险缴费 & 房贷还款日程
X-APPLE-CALENDAR-COLOR:#4ade80
"""

ICS_FOOTER = "END:VCALENDAR\n"

def vevent_block(uid, dt_start, summary, description, rrule, alarm_minutes=-30):
    """生成一个 VEVENT 块。dt_start 应为 naive datetime（本地时间）。"""
    dt_str = dt_start.strftime("%Y%m%dT%H%M%S")
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTART:{dt_str}",
        f"SUMMARY:{summary}",
        f"DESCRIPTION:{description}",
        f"RRULE:{rrule}",
        "BEGIN:VALARM",
        f"TRIGGER:-PT{abs(alarm_minutes)}M",
        "ACTION:DISPLAY",
        f"DESCRIPTION:提醒：{summary}",
        "END:VALARM",
        "END:VEVENT",
    ]
    return "\n".join(lines)

# ── 数据定义（与 JS 文件同步） ──
insurances = [
    # contractNo, company, product, person, premium, payPeriod, nextPayDate
    ("C398208857", "友邦保险", "自在宝终身寿险（万能型）", "典", 100,
     "2023-2027", "2027-01-01"),
    ("C181202361", "友邦保险", "友未来年金保险", "典", 32035,
     "2023-2032", "2027-01-01"),
    ("H133022599", "友邦保险", "长保康惠长期医疗保险", "典", 920,
     "每年续保", "2026-12-16"),
    ("C390562708", "友邦保险", "全佑惠享珍藏版重疾险", "典", 11263.77,
     "2020-2042", "2026-12-16"),
    ("C182507751", "友邦保险", "创赢未来年金保险（木）", "木", 27939.6,
     "2023-2032", "2027-01-01"),
    ("C185221966", "友邦保险", "悦享年年金保险", "静", 12000,
     "2023-2032", "2027-04-24"),
    ("C182507696", "友邦保险", "友未来年金保险（静）", "静", 50305,
     "2023-2028", "2027-01-01"),
    ("H98208831", "友邦保险", "自在宝终身寿险-万能型（静）", "静", 100,
     "2023-2027", "2027-01-01"),
    ("C181202578", "友邦保险", "双赢两全保险（静）", "静", 2720,
     "2022-2041", "2027-01-28"),
    ("C395062711", "友邦保险", "全佑惠享珍藏版重疾险（静）", "静", 10230.59,
     "2020-2042", "2026-12-23"),
    ("H133022586", "友邦保险", "智选康惠荣耀医疗保险", "静", 920,
     "每年续保", "2026-12-23"),
    ("C82507780", "友邦保险", "创赢未来年金保险（木·静买）", "木", 43572.6,
     "2023-2028", "2027-01-01"),
    ("C181202659", "友邦保险", "双赢两全保险（木）", "木", 2715,
     "2022-2041", "2027-01-28"),
    ("H133022531", "友邦保险", "长保康惠长期医疗保险（木）", "木", 490,
     "每年续保", "2026-12-17"),
    ("C395062737", "友邦保险", "全佑倍呵护珍藏版重疾险（木）", "木", 5091.84,
     "2020-2042", "2026-12-14"),
]

loans = [
    {
        "bank": "兴业银行上海虹口支行（公积金）",
        "property": "住房贷款-公积金部分",
        "total": 700000,
        "balance": 194984.98,
        "rate": 2.6,
        "months": 180,
        "start": "2014-12-26",
        "end": "2029-12-26",
        "loanType": "公积金",
    },
    {
        "bank": "兴业银行上海虹口支行（商业贷款）",
        "property": "住房贷款-商业部分",
        "total": 800000,
        "balance": 424955.42,
        "rate": 3.2,
        "months": 240,
        "start": "2014-12-26",
        "end": "2034-12-26",
        "loanType": "商业贷款",
    },
]

TODAY = date.today()
OUTPUT = Path(__file__).resolve().parent.parent / "家庭资产管理-缴费还款日历.ics"

def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d")

def extract_end_year(period_str):
    """从 '2023-2032 · 10年' 提取结束年份"""
    parts = period_str.replace("·", " ").split()
    for p in parts:
        if "-" in p and p[0].isdigit():
            segs = p.split("-")
            if len(segs) == 2 and segs[1].isdigit():
                return int(segs[1])
    return None

def main():
    events = []

    # ── 保险事件 ──
    for i, (cno, co, prod, person, prem, period, next_pay) in enumerate(insurances):
        if not next_pay:
            continue
        dt = parse_date(next_pay)
        end_year = extract_end_year(period)
        if end_year is None:
            # 每年续保 → 往后 10 年
            until = dt.replace(year=dt.year + 10)
        else:
            until = dt.replace(year=end_year)

        uid = f"insurance-{cno}@family-finance"
        summary = f"💰 {person} · {prod}"
        desc = (
            f"保险公司：{co}\\n"
            f"产品：{prod}\\n"
            f"被保人：{person}\\n"
            f"年缴保费：¥{prem:,.2f}\\n"
            f"合同号：{cno}\\n"
            f"缴费周期：{period}"
        )
        rrule = yearly_rrule(dt, until)
        events.append(vevent_block(uid, dt, summary, desc, rrule, alarm_minutes=-1440))
        print(f"  [保险] {person} · {prod} → 每年 {dt.strftime('%m-%d')}，至 {until.year}，¥{prem:,.2f}")

    # ── 房贷事件 ──
    for i, loan in enumerate(loans):
        dt = parse_date(loan["start"])
        end_dt = parse_date(loan["end"])
        month_pay = monthly_payment(loan["total"], loan["rate"], loan["months"])

        uid = f"loan-{loan['loanType']}@family-finance"
        summary = f"🏠 {loan['loanType']}房贷月供"
        desc = (
            f"银行：{loan['bank']}\\n"
            f"贷款类型：{loan['loanType']}\\n"
            f"贷款总额：¥{loan['total']:,.0f}\\n"
            f"剩余本金：¥{loan['balance']:,.2f}\\n"
            f"年利率：{loan['rate']}%\\n"
            f"期限：{loan['months']}个月 ({loan['start']} ~ {loan['end']})\\n"
            f"月供（等额本息）：¥{month_pay:,.2f}"
        )
        rrule = monthly_rrule(dt, end_dt)
        events.append(vevent_block(uid, dt, summary, desc, rrule, alarm_minutes=-1440))
        print(f"  [房贷] {loan['loanType']} → 月供 ¥{month_pay:,.2f}，{loan['start']} ~ {loan['end']}")

    # ── 写入文件 ──
    ics_content = ICS_HEADER + "\n".join(events) + "\n" + ICS_FOOTER
    OUTPUT.write_text(ics_content, encoding="utf-8")
    print(f"\n✅ 已生成：{OUTPUT}")
    print(f"   共 {len(insurances)} 项保险 + {len(loans)} 笔贷款")
    print(f"   可直接发送到 iPhone → 用「文件」App 打开 → 自动导入「日历」")

if __name__ == "__main__":
    main()
