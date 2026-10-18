# -*- coding: utf-8 -*-
"""
个人校园消费记账 GUI —— 初版
================================================================
面向大学生的桌面生活费记账工具。

核心功能：
  1. 记账（消费与存入合在一起）：
       用户先点击“记一笔”确认要记账，再选择这笔是“消费”还是“存入”：
         - 消费：填写 分类、金额、备注；分类限定为
           「能力提升、饮食、购物、娱乐活动」四类；
         - 存入：只需填写 金额、备注；
       日期默认为今天，可自行修改以“补记”过去漏掉的账（不接受未来日期）；
  2. 修改与删除：在明细行上点击右键，可选择“编辑记录”或“删除记录”；
       编辑时可以修改这条账的任意字段（含把消费改成存入、修改日期）；
  3. 按月查看历史账单：通过“◀ / ▶”切换查看月份，
       明细、每日余额、消费分析都随所选月份联动；
  4. 余额统计：
       - 总览（本月支出 / 本月剩余 / 今日支出 / 剩余天数 / 建议日均）；
       - 按天统计（每日支出、累计支出、每日结束时的余额）；
       统计只计入“消费”，存入不参与预算余额与预警；
  5. 消费分析：按分类展示所选月份的消费条形统计图（Canvas 手绘，无第三方依赖）；
  6. 额度提醒：预算可按月分别设置，消费达到预警比例或已超支时弹窗提醒、总览条变色。

技术选型（初版刻意保持简单、零第三方依赖，便于审查）：
  - GUI：Python 标准库 tkinter / ttk；
  - 存储：本地 JSON 文件（bill_data.json，与脚本同目录，首次运行自动创建）；
  - 金额：统一用 float 记录、展示时保留两位小数（个人记账精度足够，
          后续若需要可替换为 decimal.Decimal）。

运行方式：
  python bill_tracker.py
"""

import calendar
import json
import os
import uuid
from datetime import date, datetime

import tkinter as tk
from tkinter import ttk, messagebox

# =================================================================
# 一、全局常量
# =================================================================

# 数据文件路径：固定放在脚本所在目录，避免“换个目录运行就找不到数据”
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "bill_data.json")

# 消费“类型”为固定枚举，用户只能从下拉框选择，保证每条消费记录分类明确。
# 后续若要增减类型，只需改这一处。
CATEGORIES = ["能力提升", "饮食", "购物", "娱乐活动"]

# 一笔账的“类型”（资金方向）：消费或存入。用常量避免各处手写字符串写错
KIND_EXPENSE = "消费"
KIND_DEPOSIT = "存入"
RECORD_KINDS = [KIND_EXPENSE, KIND_DEPOSIT]

# 日期统一使用 ISO 格式字符串（YYYY-MM-DD），方便排序与比较
DATE_FMT = "%Y-%m-%d"

# 预警状态对应的颜色（绿=正常，橙=预警，红=超支，灰=未设置预算）
COLOR_OK = "#2e7d32"
COLOR_WARN = "#ef6c00"
COLOR_OVER = "#c62828"
COLOR_IDLE = "#757575"


# =================================================================
# 二、数据层：负责 JSON 的读写与流水的增删
#    （UI 不直接碰文件，后续换成数据库时只需改这一层）
# =================================================================
class DataStore:
    """本地数据存取。数据包含 budget（预算）和 records（统一流水：消费+存入）两部分。"""

    def __init__(self, path: str = DATA_FILE):
        self.path = path
        self.data = self._load()

    # ---------- 底层读写 ----------

    def _default_data(self) -> dict:
        """首次使用时的初始数据：预算为 0（表示未设置），预警比例 80%。"""
        return {
            "budget": {
                "monthly_amount": 0.0,   # 兼容字段：当前月预算（元），0 表示未设置
                "alert_threshold": 0.8,  # 兼容字段：当前月预警比例（0.8=80%）
                # 按月保存的预算表：{ "2026-10": {"amount":..., "alert_threshold":...} }
                # “保存设置”只写当前月；查看历史月份时取这里的对应值
                "monthly": {},
            },
            "records": [],  # 统一流水（消费与存入），元素结构见 add_record()
        }

    def _load(self) -> dict:
        """从 JSON 文件读取；文件不存在或损坏时返回初始数据，不让程序崩溃。"""
        if not os.path.exists(self.path):
            return self._default_data()
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            # 结构校验与旧数据迁移
            data.setdefault("budget", {})
            data["budget"].setdefault("monthly_amount", 0.0)
            data["budget"].setdefault("alert_threshold", 0.8)
            data["budget"].setdefault("monthly", {})  # 旧文件：补上月预算表
            # 旧版本把消费、存入分存在 expenses / deposits 两个列表里。
            # 这里一次性合并进 records，保证升级后老账不丢、统一展示。
            if "records" not in data:
                merged = []
                for e in data.get("expenses", []):
                    merged.append({
                        "id": e.get("id", uuid.uuid4().hex),
                        "date": e["date"],
                        "kind": KIND_EXPENSE,
                        "category": e.get("category", ""),
                        "amount": e["amount"],
                        "note": e.get("note", ""),
                        "created_at": e.get("created_at", ""),
                    })
                for d in data.get("deposits", []):
                    merged.append({
                        "id": d.get("id", uuid.uuid4().hex),
                        "date": d["date"],
                        "kind": KIND_DEPOSIT,
                        "category": None,          # 存入没有分类
                        "amount": d["amount"],
                        "note": d.get("note", ""),
                        "created_at": d.get("created_at", ""),
                    })
                data["records"] = merged
            return data
        except (json.JSONDecodeError, OSError):
            # 文件损坏时不直接覆盖，留一份备份再重建，避免用户数据被无声清空
            backup = self.path + ".bak"
            try:
                os.replace(self.path, backup)
            except OSError:
                pass
            return self._default_data()

    def save(self) -> None:
        """把内存中的数据写回 JSON（先写临时文件再替换，防止写一半断电导致损坏）。"""
        tmp_path = self.path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.path)

    # ---------- 预算设置（按月） ----------

    def set_budget(self, monthly_amount: float, alert_threshold: float) -> None:
        """
        保存“当前月”的预算与预警比例。
        同时写入两处：
          - monthly_amount / alert_threshold（兼容字段，代表当前月，供旧代码读取）；
          - monthly[当前月键]（查看历史账单时按月取值）。
        """
        month_key = date.today().strftime("%Y-%m")
        self.data["budget"]["monthly_amount"] = monthly_amount
        self.data["budget"]["alert_threshold"] = alert_threshold
        self.data["budget"]["monthly"][month_key] = {
            "amount": monthly_amount,
            "alert_threshold": alert_threshold,
        }
        self.save()

    def budget_amount_for(self, month_key: str) -> float:
        """返回指定月份的预算：该月没单独设置时，回退到兼容字段里的当前预算。"""
        info = self.data["budget"]["monthly"].get(month_key)
        if info is not None:
            return float(info["amount"])
        return float(self.data["budget"]["monthly_amount"])

    def threshold_for(self, month_key: str) -> float:
        """返回指定月份的预警比例；该月没单独设置时回退到当前值。"""
        info = self.data["budget"]["monthly"].get(month_key)
        if info is not None:
            return float(info["alert_threshold"])
        return float(self.data["budget"]["alert_threshold"])

    @property
    def monthly_amount(self) -> float:
        """当前月预算（保持旧接口，供总览/预警使用）。"""
        return self.budget_amount_for(date.today().strftime("%Y-%m"))

    @property
    def alert_threshold(self) -> float:
        """当前月预警比例（保持旧接口）。"""
        return self.threshold_for(date.today().strftime("%Y-%m"))

    # ---------- 统一流水（消费 + 存入） ----------

    def add_record(self, date_str: str, kind: str, amount: float,
                    note: str, category: str = None) -> dict:
        """
        新增一条记录并立即落盘。消费与存入共用这一张表。
        :param date_str: 日期 YYYY-MM-DD（默认当天，可补记过去日期）
        :param kind:     资金方向：KIND_EXPENSE（消费）或 KIND_DEPOSIT（存入）
        :param amount:   金额（元），必须为正数
        :param note:     备注，可为空
        :param category: 消费分类（CATEGORIES 四类之一）；仅消费需要，存入传 None
        :return: 新记录字典
        """
        record = {
            "id": uuid.uuid4().hex,        # 唯一标识，删除时用它定位
            "date": date_str,
            "kind": kind,
            "category": category if kind == KIND_EXPENSE else None,
            "amount": round(amount, 2),
            "note": note.strip(),
            "created_at": datetime.now().isoformat(timespec="seconds"),  # 录入时间
        }
        self.data["records"].append(record)
        self.save()
        return record

    def delete_record(self, record_id: str) -> None:
        """按 id 删除一条记录（消费、存入通用）。"""
        self.data["records"] = [
            item for item in self.data["records"] if item["id"] != record_id
        ]
        self.save()

    def get_record(self, record_id: str):
        """按 id 取一条记录，找不到返回 None（供“编辑”预填使用）。"""
        for item in self.data["records"]:
            if item["id"] == record_id:
                return item
        return None

    def update_record(self, record_id: str, date_str: str, kind: str,
                      amount: float, note: str, category: str = None):
        """
        就地修改一条记录并落盘（id 与原始录入时间 created_at 保持不变）。
        各字段含义与 add_record 相同；kind 被改成“存入”时 category 自动置空。
        :return: 更新后的记录；id 不存在时返回 None
        """
        record = self.get_record(record_id)
        if record is None:
            return None
        record["date"] = date_str
        record["kind"] = kind
        record["category"] = category if kind == KIND_EXPENSE else None
        record["amount"] = round(amount, 2)
        record["note"] = note.strip()
        self.save()
        return record

    def all_records(self) -> list:
        """返回全部记录（消费与存入在一起），按日期、录入时间倒序。"""
        return sorted(
            self.data["records"],
            key=lambda x: (x["date"], x["created_at"]),
            reverse=True,
        )

    def expenses_only(self, records: list = None) -> list:
        """从给定记录（默认全部）中挑出消费记录，供统计层使用。"""
        if records is None:
            records = self.data["records"]
        return [r for r in records if r["kind"] == KIND_EXPENSE]


# =================================================================
# 三、统计逻辑（纯函数，不依赖界面，方便单独审查与以后做单元测试）
# =================================================================

def current_month_key(today: date = None) -> str:
    """返回今天所属的月份键，如 "2026-10"。"""
    if today is None:
        today = date.today()
    return today.strftime("%Y-%m")


def shift_month(month_key: str, delta: int) -> str:
    """
    月份键前后平移 delta 个月（delta 可为负）。
    用于“◀ / ▶”按钮与跨月补记后的定位。
    """
    year, month = map(int, month_key.split("-"))
    # 先转成“从公元元年起的第几个月”做整数加减，再还原，避免手写进位分支
    index = year * 12 + (month - 1) + delta
    return f"{index // 12}-{index % 12 + 1:02d}"


def records_in_month(records: list, month_key: str) -> list:
    """从统一流水中筛出“消费日期落在指定月份”的全部记录（消费与存入都包含）。"""
    return [r for r in records if r["date"].startswith(month_key)]


def summarize_month(records: list, budget: float, today: date,
                     month_key: str = None) -> dict:
    """
    汇总指定月份（默认今天所在月）的关键指标。
    余额口径：本月剩余 = 该月预算 - 该月全部消费（按消费日期归属月份）。
    传入的是统一流水，函数内部只取 kind=消费 的记录，存入不参与统计。

    “今日支出 / 剩余天数 / 建议日均”只对“当前月”有意义；
    查看历史月份时对应字段返回 0.0 或 None。
    """
    if month_key is None:
        month_key = current_month_key(today)
    is_current_month = month_key == current_month_key(today)
    year, month = map(int, month_key.split("-"))

    first_day = date(year, month, 1)
    total_days = calendar.monthrange(year, month)[1]   # calendar 直接给出当月天数

    # 先筛出该月消费（同时满足“是消费”与“日期在该月”）
    month_expenses = [
        r for r in records
        if r["kind"] == KIND_EXPENSE and r["date"].startswith(month_key)
    ]
    month_spent = round(sum(e["amount"] for e in month_expenses), 2)
    if is_current_month:
        today_str = today.strftime(DATE_FMT)
        today_spent = round(
            sum(e["amount"] for e in month_expenses if e["date"] == today_str), 2
        )
    else:
        today_spent = 0.0

    remaining = round(budget - month_spent, 2)    # 剩余额度（可能为负，即超支）

    if is_current_month:
        # 剩余天数含今天：例如今天是本月最后一天，则为 1
        remaining_days = total_days - today.day + 1
        # 建议日均 = 剩余额度 / 剩余天数；超支或未设置预算时不给出建议
        if budget > 0 and remaining_days > 0:
            suggested_daily = round(remaining / remaining_days, 2)
        else:
            suggested_daily = None
    else:
        remaining_days = None
        suggested_daily = None

    return {
        "month_spent": month_spent,
        "today_spent": today_spent,
        "remaining": remaining,
        "remaining_days": remaining_days,
        "total_days": total_days,
        "suggested_daily": suggested_daily,
    }


def build_daily_rows(records: list, budget: float, today: date,
                     month_key: str = None) -> list:
    """
    生成指定月份（默认当前月）“每日余额统计”表格数据：该月每一天一行。
    当日余额 = 该月预算 - 截至当天的累计消费
    （只统计消费；后面的日期没有消费，余额会沿用上一天的值）。
    返回 [(日期对象, 星期文本, 当日支出, 累计支出, 当日余额), ...]
    """
    if month_key is None:
        month_key = current_month_key(today)
    year, month = map(int, month_key.split("-"))
    total_days = calendar.monthrange(year, month)[1]

    # 先把该月消费按“天”聚合：{ "2026-10-01": 23.5, ... }；存入不计入
    spent_by_day = {}
    for r in records:
        if r["kind"] == KIND_EXPENSE and r["date"].startswith(month_key):
            spent_by_day[r["date"]] = spent_by_day.get(r["date"], 0.0) + r["amount"]

    weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    rows = []
    cumulative = 0.0
    for day in range(1, total_days + 1):
        cur = date(year, month, day)
        day_spent = round(spent_by_day.get(cur.strftime(DATE_FMT), 0.0), 2)
        cumulative = round(cumulative + day_spent, 2)
        balance = round(budget - cumulative, 2)
        rows.append((cur, weekday_names[cur.weekday()], day_spent, cumulative, balance))
    return rows


def category_totals(records: list, month_key: str) -> dict:
    """
    按分类汇总指定月份的消费（供“分析”标签页画条形图）。
    返回按 CATEGORIES 固定顺序的 {分类: 金额}，没花到的分类也是 0.0，
    保证条形图柱子数量与顺序稳定。
    """
    totals = {category: 0.0 for category in CATEGORIES}
    for r in records:
        if r["kind"] == KIND_EXPENSE and r["date"].startswith(month_key):
            totals[r["category"]] = round(totals[r["category"]] + r["amount"], 2)
    return totals


def deposit_total(records: list, month_key: str) -> float:
    """指定月份的存入合计（分析页展示用；统计/预警不含它）。"""
    return round(sum(
        r["amount"] for r in records
        if r["kind"] == KIND_DEPOSIT and r["date"].startswith(month_key)
    ), 2)


# =================================================================
# 四、界面层
# =================================================================

class RecordDialog(tk.Toplevel):
    """
    “记一笔 / 编辑记录”弹窗（模态）。
    新增流程：第 1 步单选 消费 / 存入；第 2 步消费需选分类（存入自动禁用），
              再填金额、备注；日期默认今天，可手动改成过去日期以“补记”。
    编辑流程：传入 record=原记录，所有字段按原值预填，可任意修改。
    弹窗只负责采集输入，校验与落盘由主窗口通过 on_confirm 回调完成。
    """

    def __init__(self, parent, record: dict = None):
        super().__init__(parent)
        self.record_id = record["id"] if record else None   # 非空=编辑模式
        self.title("编辑记录" if record else "记一笔")
        self.resizable(False, False)

        # —— 第 1 步：资金方向 ——
        step1 = ttk.LabelFrame(self, text="第 1 步：这笔是？")
        step1.pack(fill="x", padx=10, pady=(10, 6))
        self.var_kind = tk.StringVar(
            value=record["kind"] if record else KIND_EXPENSE
        )
        ttk.Radiobutton(
            step1, text="消费", value=KIND_EXPENSE,
            variable=self.var_kind, command=self._on_kind_change,
        ).pack(side="left", padx=(20, 24), pady=8)
        ttk.Radiobutton(
            step1, text="存入", value=KIND_DEPOSIT,
            variable=self.var_kind, command=self._on_kind_change,
        ).pack(side="left", pady=8)

        # —— 第 2 步：具体信息 ——
        step2 = ttk.LabelFrame(self, text="第 2 步：填写信息")
        step2.pack(fill="x", padx=10, pady=6)

        # 日期：默认今天；编辑或补记时可改（主窗口负责校验合法且不晚于今天）
        ttk.Label(step2, text="日期：").grid(row=0, column=0, padx=(10, 4), pady=8, sticky="e")
        self.var_date = tk.StringVar(
            value=record["date"] if record else date.today().strftime(DATE_FMT)
        )
        ttk.Entry(step2, textvariable=self.var_date, width=12).grid(row=0, column=1)

        self.lbl_category = ttk.Label(step2, text="分类：")
        self.lbl_category.grid(row=0, column=2, padx=(20, 4), sticky="e")
        # 编辑存入记录时分类为 None，预填默认值“饮食”但该字段随后会被禁用
        self.var_category = tk.StringVar(
            value=(record["category"] if record and record["category"] else "饮食")
        )
        self.cmb_category = ttk.Combobox(
            step2, textvariable=self.var_category,
            values=CATEGORIES, width=12, state="readonly",
        )
        self.cmb_category.grid(row=0, column=3, pady=8)

        ttk.Label(step2, text="金额（元）：").grid(row=0, column=4, padx=(20, 4), sticky="e")
        self.var_amount = tk.StringVar(
            value=(f"{record['amount']:.2f}" if record else "")
        )
        ttk.Entry(step2, textvariable=self.var_amount, width=10).grid(row=0, column=5)

        ttk.Label(step2, text="备注：").grid(row=1, column=0, padx=(10, 4), pady=(0, 8), sticky="e")
        self.var_note = tk.StringVar(value=record["note"] if record else "")
        ttk.Entry(step2, textvariable=self.var_note, width=46).grid(
            row=1, column=1, columnspan=5, pady=(0, 8), sticky="w"
        )

        # —— 底部按钮 ——
        btns = ttk.Frame(self)
        btns.pack(fill="x", padx=10, pady=(2, 10))
        ttk.Button(
            btns, text="保存修改" if record else "确认记账", command=self._on_ok
        ).pack(side="right")
        ttk.Button(btns, text="取消", command=self.destroy).pack(side="right", padx=(0, 8))

        # 由主窗口注入：接收 payload，返回错误信息字符串=校验失败（弹窗保留），
        # 返回 None=成功（弹窗自行关闭）
        self.on_confirm = None

        # 按预填的资金方向同步一次分类字段启用/禁用状态
        self._on_kind_change()

        # 模态设置：置于主窗口之上并独占输入
        self.transient(parent)
        self.grab_set()

    def _on_kind_change(self):
        """切到“存入”时禁用分类字段；切回“消费”时启用。"""
        if self.var_kind.get() == KIND_EXPENSE:
            self.cmb_category.configure(state="readonly")
            self.lbl_category.configure(state="normal")
        else:
            self.cmb_category.configure(state="disabled")
            self.lbl_category.configure(state="disabled")

    def payload(self) -> dict:
        """汇总用户输入，交给主窗口校验；id 非空表示这是编辑提交。"""
        return {
            "id": self.record_id,
            "date": self.var_date.get().strip(),
            "kind": self.var_kind.get(),
            "category": self.var_category.get().strip(),
            "amount": self.var_amount.get().strip(),
            "note": self.var_note.get(),
        }

    def _on_ok(self):
        error = self.on_confirm(self.payload())
        if error:
            # 校验失败：在弹窗内提示，不关闭，方便用户直接改
            messagebox.showerror("输入有误", error, parent=self)
            return
        self.destroy()


class BillTrackerApp(tk.Tk):
    """主窗口：预算设置 + 总览提醒 + 月份切换 + 记账/明细/分析/每日统计。"""

    def __init__(self):
        super().__init__()
        self.store = DataStore()

        # 当前正在查看的月份（与“真实今天”相互独立），初始为本月。
        # 三个标签页的内容都跟随它；总览与额度提醒始终反映真实本月。
        self.var_view_month = tk.StringVar(value=current_month_key())
        self._pending_notice = None

        # 窗口基础设置
        self.title("个人校园消费记账")
        self.geometry("860x720")
        self.minsize(800, 640)

        self._build_budget_panel()   # 顶部：当前月预算设置
        self._build_dashboard()      # 中上部：本月总览 + 额度提醒
        self._build_month_selector() # 中下部：查看月份切换
        self._build_notebook()       # 下部：明细 / 每日统计 / 分析 三个标签页

        self.refresh_all()           # 首次填充数据

    # ---------- 顶部：预算设置 ----------

    def _build_budget_panel(self):
        frame = ttk.LabelFrame(self, text="预算设置（按月）")
        frame.pack(fill="x", padx=10, pady=(10, 6))

        ttk.Label(frame, text="本月生活费预算（元）：").grid(
            row=0, column=0, padx=(10, 4), pady=8, sticky="e"
        )
        self.var_budget = tk.StringVar()
        ttk.Entry(frame, textvariable=self.var_budget, width=12).grid(
            row=0, column=1, pady=8
        )

        ttk.Label(frame, text="预警比例（%）：").grid(
            row=0, column=2, padx=(20, 4), pady=8, sticky="e"
        )
        self.var_threshold = tk.StringVar()
        ttk.Entry(frame, textvariable=self.var_threshold, width=8).grid(
            row=0, column=3, pady=8
        )

        ttk.Button(frame, text="保存设置", command=self.on_save_budget).grid(
            row=0, column=4, padx=20
        )

        ttk.Label(
            frame, text="说明：消费达到预算的预警比例（如 80%）时会弹窗并高亮提醒。",
            foreground=COLOR_IDLE,
        ).grid(row=0, column=5, padx=10)

    # ---------- 中部：总览 + 额度提醒 ----------

    def _build_dashboard(self):
        frame = ttk.LabelFrame(self, text="本月总览")
        frame.pack(fill="x", padx=10, pady=6)

        # 五个指标卡片，每个都是“标题 + 数值”，数值标签留待刷新时改文字
        self.lbl_month_spent = self._make_stat_cell(frame, 0, "本月支出（元）")
        self.lbl_remaining = self._make_stat_cell(frame, 1, "本月剩余（元）")
        self.lbl_today_spent = self._make_stat_cell(frame, 2, "今日支出（元）")
        self.lbl_remaining_days = self._make_stat_cell(frame, 3, "剩余天数（天）")
        self.lbl_suggested = self._make_stat_cell(frame, 4, "建议日均（元）")

        # 额度提醒状态条：通过背景色直观表达正常/预警/超支
        self.lbl_alert = tk.Label(
            self, text="", font=("微软雅黑", 11, "bold"),
            fg="white", bg=COLOR_IDLE, pady=6,
        )
        self.lbl_alert.pack(fill="x", padx=10, pady=(2, 6))

    def _make_stat_cell(self, parent, column: int, title: str) -> tk.Label:
        """在总览区造一个指标格子，返回“数值标签”以便后续更新。"""
        cell = ttk.Frame(parent)
        cell.grid(row=0, column=column, padx=12, pady=10, sticky="nsew")
        parent.columnconfigure(column, weight=1)  # 五列等宽，随窗口拉伸
        ttk.Label(cell, text=title, foreground=COLOR_IDLE).pack()
        value_label = ttk.Label(cell, text="--", font=("微软雅黑", 16, "bold"))
        value_label.pack(pady=(2, 0))
        return value_label

    # ---------- 中下部：查看月份切换条 ----------

    def _build_month_selector(self):
        """◀ / ▶ 切换查看的历史月份；不能翻到未来；可一键回到本月。"""
        bar = ttk.Frame(self)
        bar.pack(fill="x", padx=10, pady=(2, 4))

        ttk.Label(bar, text="查看月份：").pack(side="left")
        self.btn_prev_month = ttk.Button(
            bar, text="◀ 上一月", command=self.on_prev_month
        )
        self.btn_prev_month.pack(side="left", padx=(4, 8))

        # 月份文字用加粗标签，当前查看的不是本月时加“(历史)”提示
        self.lbl_view_month = ttk.Label(bar, text="", font=("微软雅黑", 11, "bold"))
        self.lbl_view_month.pack(side="left")

        self.btn_next_month = ttk.Button(
            bar, text="下一月 ▶", command=self.on_next_month
        )
        self.btn_next_month.pack(side="left", padx=(8, 4))

        ttk.Button(bar, text="回到本月", command=self.on_this_month).pack(side="left", padx=(12, 0))

    # ---------- 下部：标签页（明细、每日统计、分析） ----------

    def _build_notebook(self):
        notebook = ttk.Notebook(self)
        notebook.pack(fill="both", expand=True, padx=10, pady=(4, 10))
        self.notebook = notebook   # 保存引用，便于切换标签页（如自检/联动）

        self._build_records_tab(notebook)
        self._build_daily_tab(notebook)
        self._build_analysis_tab(notebook)

    def _build_records_tab(self, notebook):
        """统一记账页：一个入口按钮“记一笔” + 消费/存入混合明细表。"""
        tab = ttk.Frame(notebook)
        notebook.add(tab, text="记账 / 明细")

        # —— 记账入口条：先点这里确认“要记账” ——
        entry_bar = ttk.Frame(tab)
        entry_bar.pack(fill="x", padx=8, pady=(8, 4))
        ttk.Button(entry_bar, text="记一笔", command=self.on_open_record_dialog).pack(side="left")
        ttk.Label(
            entry_bar,
            text="点击后先选“消费/存入”再填写；日期默认今天，可修改以补记漏账。",
            foreground=COLOR_IDLE,
        ).pack(side="left", padx=12)

        # —— 明细表：展示“查看月份”内的记录（消费与存入在一起） ——
        list_frame = ttk.LabelFrame(tab, text="该月全部记录（倒序；右键行可编辑/删除）")
        list_frame.pack(fill="both", expand=True, padx=8, pady=6)

        # “类型”列表示这笔是消费还是存入；“分类”列仅消费有值，存入显示 —
        columns = ("date", "kind", "category", "amount", "note")
        self.tree_records = ttk.Treeview(
            list_frame, columns=columns, show="headings", selectmode="browse"
        )
        self.tree_records.heading("date", text="日期")
        self.tree_records.heading("kind", text="类型")
        self.tree_records.heading("category", text="分类")
        self.tree_records.heading("amount", text="金额（元）")
        self.tree_records.heading("note", text="备注")
        self.tree_records.column("date", width=120, anchor="center")
        self.tree_records.column("kind", width=80, anchor="center")
        self.tree_records.column("category", width=100, anchor="center")
        self.tree_records.column("amount", width=110, anchor="e")
        self.tree_records.column("note", width=300, anchor="w")

        # 存入记录整行用绿色字，和消费在视觉上区分开
        self.tree_records.tag_configure("deposit", foreground=COLOR_OK)

        # 右键上下文菜单：编辑记录 / 删除记录（Windows 右键事件为 <Button-3>）。
        # 菜单对象只建一次，弹出时根据右键命中的行定位记录。
        self.menu_record = tk.Menu(self, tearoff=0)
        self.menu_record.add_command(label="编辑记录", command=self.on_edit_record)
        self.menu_record.add_separator()
        self.menu_record.add_command(label="删除记录", command=self.on_delete_record)
        self.tree_records.bind("<Button-3>", self.on_records_right_click)

        # iid 直接用记录 id，删除时拿选中项的 iid 即可
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical",
                                  command=self.tree_records.yview)
        self.tree_records.configure(yscrollcommand=scrollbar.set)
        self.tree_records.pack(side="left", fill="both", expand=True, padx=(8, 0), pady=8)
        scrollbar.pack(side="right", fill="y", pady=8)

        ttk.Button(tab, text="删除选中记录", command=self.on_delete_record).pack(
            anchor="e", padx=12, pady=(0, 8)
        )

    def _build_daily_tab(self, notebook):
        tab = ttk.Frame(notebook)
        notebook.add(tab, text="每日余额统计")
        # 展示“查看月份”的余额，标题不再写“本月”
        list_frame = ttk.LabelFrame(
            tab, text="该月每日余额（当日余额 = 该月预算 - 截至当日累计消费）"
        )
        list_frame.pack(fill="both", expand=True, padx=8, pady=8)

        columns = ("date", "weekday", "day_spent", "cumulative", "balance")
        self.tree_daily = ttk.Treeview(
            list_frame, columns=columns, show="headings", selectmode="browse"
        )
        self.tree_daily.heading("date", text="日期")
        self.tree_daily.heading("weekday", text="星期")
        self.tree_daily.heading("day_spent", text="当日支出（元）")
        self.tree_daily.heading("cumulative", text="累计支出（元）")
        self.tree_daily.heading("balance", text="当日余额（元）")
        self.tree_daily.column("date", width=140, anchor="center")
        self.tree_daily.column("weekday", width=80, anchor="center")
        self.tree_daily.column("day_spent", width=140, anchor="e")
        self.tree_daily.column("cumulative", width=140, anchor="e")
        self.tree_daily.column("balance", width=140, anchor="e")

        # 今天这一行加底色高亮（tags 在刷新时打）
        self.tree_daily.tag_configure("today", background="#fff3cd")
        # 余额为负（已超支）的日子标红字
        self.tree_daily.tag_configure("negative", foreground=COLOR_OVER)

        scrollbar = ttk.Scrollbar(list_frame, orient="vertical",
                                  command=self.tree_daily.yview)
        self.tree_daily.configure(yscrollcommand=scrollbar.set)
        self.tree_daily.pack(side="left", fill="both", expand=True, padx=(8, 0), pady=8)
        scrollbar.pack(side="right", fill="y", pady=8)

    def _build_analysis_tab(self, notebook):
        """
        消费分析页：用 Canvas 手绘“各分类消费金额”垂直条形图。
        不引入 matplotlib，保持零第三方依赖；柱子随窗口大小自适应。
        """
        tab = ttk.Frame(notebook)
        notebook.add(tab, text="消费分析")

        frame = ttk.LabelFrame(tab, text="各分类消费条形图（跟随“查看月份”）")
        frame.pack(fill="both", expand=True, padx=8, pady=8)

        # 白底画布，留作绘图区；背景色与常见纸张一致
        self.canvas_chart = tk.Canvas(frame, bg="white", highlightthickness=0)
        self.canvas_chart.pack(fill="both", expand=True, padx=8, pady=8)

        # 记录上次画布尺寸，仅在尺寸真正变化时重绘（避免多余的清空闪烁）
        self._chart_size = (0, 0)
        # 窗口拖动导致画布尺寸变化时重绘，保证柱子始终铺满
        self.canvas_chart.bind("<Configure>", self._on_chart_configure)

    # =================================================================
    # 五、事件处理
    # =================================================================

    def on_save_budget(self):
        """校验并保存预算设置。"""
        # 预算：非负数字
        try:
            budget = float(self.var_budget.get().strip())
            if budget < 0:
                raise ValueError
        except ValueError:
            messagebox.showerror("输入有误", "预算请输入不小于 0 的数字。")
            return

        # 预警比例：1~100 的整数（小数也允许），存成 0~1
        try:
            threshold_pct = float(self.var_threshold.get().strip())
            if not (1 <= threshold_pct <= 100):
                raise ValueError
        except ValueError:
            messagebox.showerror("输入有误", "预警比例请输入 1 ~ 100 之间的数字（如 80）。")
            return

        self.store.set_budget(round(budget, 2), round(threshold_pct / 100, 4))
        self.refresh_all()
        messagebox.showinfo("已保存", "预算设置已保存。")

    def on_open_record_dialog(self):
        """“记一笔”按钮：打开新增弹窗（日期默认今天）。"""
        self._open_record_dialog(None)

    def _open_record_dialog(self, record):
        """
        打开新增/编辑弹窗（record 非空为编辑模式）；
        弹窗关闭后再执行后续提醒，避免两个模态窗口重叠。
        """
        # 已有弹窗打开时不重复弹，仅提到最前
        existing = getattr(self, "record_dialog", None)
        if existing is not None and existing.winfo_exists():
            existing.lift()
            return

        dlg = RecordDialog(self, record)
        dlg.on_confirm = self._handle_record_confirm
        self.record_dialog = dlg

        # 阻塞等待弹窗关闭（局部事件循环，不影响界面响应）
        self.wait_window(dlg)
        self.record_dialog = None

        # 弹窗关闭后执行记账过程中产生的后续通知（超支/预警/补记成功等）
        notice = self._pending_notice
        self._pending_notice = None
        if notice is not None:
            notice()

    def on_records_right_click(self, event):
        """在明细表上右键：先选中右键命中的行，再弹出“编辑/删除”菜单。"""
        row_id = self.tree_records.identify_row(event.y)
        if not row_id:
            return  # 右键空白处不弹菜单，避免对空操作
        self.tree_records.selection_set(row_id)
        self.tree_records.focus(row_id)
        self.menu_record.post(event.x_root, event.y_root)

    def on_edit_record(self):
        """取选中的原始记录，以编辑模式打开弹窗（各字段原样预填）。"""
        selected = self.tree_records.selection()
        if not selected:
            messagebox.showinfo("提示", "请先在表格中选中要编辑的记录。")
            return
        record = self.store.get_record(selected[0])
        if record is None:
            messagebox.showerror("错误", "找不到这条记录，可能已经被删除。")
            return
        self._open_record_dialog(record)

    def _handle_record_confirm(self, data: dict):
        """
        处理弹窗提交（新增或编辑）：校验 → 落盘 → 刷新；
        返回错误信息字符串表示失败，None 表示成功（弹窗关闭）。
        """
        today = date.today()
        kind = data["kind"]
        note = data["note"]

        # 1) 日期：必须是合法的 YYYY-MM-DD，且不晚于今天（不允许记未来账）
        date_str = data["date"]
        try:
            record_date = datetime.strptime(date_str, DATE_FMT).date()
        except (ValueError, TypeError):
            return "日期格式不正确，请按“年-月-日”填写，例如 2026-10-01。"
        if record_date > today:
            return "不能记录未来日期哦，日期请选择今天或之前。"

        # 2) 金额：必须为正数
        try:
            amount = float(data["amount"])
            if amount <= 0:
                raise ValueError
        except ValueError:
            return "金额请输入大于 0 的数字。"

        is_edit = data.get("id") is not None
        action_word = "修改" if is_edit else "记录"
        # 这笔记录归属的月份；保存后把查看月份切过去，让用户立刻看到结果
        target_month = f"{record_date.year:04d}-{record_date.month:02d}"
        real_month = current_month_key(today)

        # 3) 按资金方向分别处理
        if kind == KIND_EXPENSE:
            category = data["category"]
            # 防御性校验：消费分类必须在固定四类内
            if category not in CATEGORIES:
                return "请从下拉框中选择消费分类。"

            # 预警只对“真实本月”的消费判断；补记到历史月份不弹额度提醒。
            # 记前先算一次预算使用率，判断这笔是否“刚好跨过”预警线/超支线。
            budget = self.store.budget_amount_for(target_month)
            ratio_before = None
            if target_month == real_month and budget > 0:
                before = summarize_month(
                    self.store.all_records(), budget, today, target_month
                )
                ratio_before = before["month_spent"] / budget

            # 落盘：有 id=更新原记录（id、created_at 不变）；无 id=新增
            if is_edit:
                self.store.update_record(
                    data["id"], date_str, kind, round(amount, 2), note, category
                )
            else:
                self.store.add_record(
                    date_str, kind, round(amount, 2), note, category
                )

            # 切到该笔所在月份并重绘
            self.var_view_month.set(target_month)
            self.refresh_all()

            # 组织记账后的通知（弹窗关闭后再显示）
            if target_month == real_month and budget > 0:
                after = summarize_month(
                    self.store.all_records(), budget, today, target_month
                )
                ratio_after = after["month_spent"] / budget
                threshold = self.store.threshold_for(target_month)
                if ratio_after >= 1.0 and ratio_before < 1.0:
                    self._pending_notice = lambda: messagebox.showwarning(
                        "额度提醒：已超支",
                        f"本月预算 {budget:.2f} 元已用完并超支！\n"
                        f"当前已支出 {after['month_spent']:.2f} 元，"
                        f"超出 {-after['remaining']:.2f} 元，请注意节制～",
                    )
                elif ratio_after >= threshold and ratio_before < threshold:
                    self._pending_notice = lambda: messagebox.showwarning(
                        "额度提醒",
                        f"本月预算已使用 {ratio_after * 100:.0f}%（预警线 "
                        f"{threshold * 100:.0f}%）。\n"
                        f"已支出 {after['month_spent']:.2f} 元，"
                        f"剩余 {after['remaining']:.2f} 元，"
                        f"建议日均不超过 {after['suggested_daily']:.2f} 元。",
                    )
            elif target_month == real_month and not is_edit:
                # 当前月新增、又没设预算时温和提示一次（不阻断记账）
                self._pending_notice = lambda: messagebox.showinfo(
                    "小提示", "你还没有设置本月预算，建议先在顶部设置生活费额度。"
                )
            elif target_month != real_month:
                # 补记/改到历史月份：给一个轻量确认，明确记账日期
                self._pending_notice = lambda: messagebox.showinfo(
                    "已保存", f"已为 {date_str} {action_word}消费 {amount:.2f} 元。"
                )
        elif kind == KIND_DEPOSIT:
            # 存入：无分类，不参与预算与预警
            if is_edit:
                self.store.update_record(
                    data["id"], date_str, kind, round(amount, 2), note, None
                )
            else:
                self.store.add_record(
                    date_str, kind, round(amount, 2), note, None
                )
            self.var_view_month.set(target_month)
            self.refresh_all()
            self._pending_notice = lambda: messagebox.showinfo(
                "存入成功", f"已{action_word}存入 {amount:.2f} 元。"
            )
        else:
            return "请先选择这笔是消费还是存入。"

        return None

    def on_delete_record(self):
        """删除在明细表中选中的记录（二次确认，防误删）。"""
        selected = self.tree_records.selection()
        if not selected:
            messagebox.showinfo("提示", "请先在表格中选中要删除的记录。")
            return
        record_id = selected[0]  # Treeview 的 iid 就是记录 id
        if messagebox.askyesno("确认删除", "确定删除这条记录吗？此操作不可撤销。"):
            self.store.delete_record(record_id)
            self.refresh_all()

    # ---------- 月份切换 ----------

    def on_prev_month(self):
        """查看上一个月（可以无限往前翻历史）。"""
        self.var_view_month.set(shift_month(self.var_view_month.get(), -1))
        self.refresh_all()

    def on_next_month(self):
        """查看下一个月；已是真实本月时不允许翻到未来。"""
        target = shift_month(self.var_view_month.get(), 1)
        if target > current_month_key():
            return
        self.var_view_month.set(target)
        self.refresh_all()

    def on_this_month(self):
        """一键回到真实本月。"""
        self.var_view_month.set(current_month_key())
        self.refresh_all()

    # =================================================================
    # 六、界面刷新（数据变化后统一调用）
    # =================================================================

    def refresh_all(self):
        """重绘预算栏、总览、月份条、当月明细表、每日统计表与分析图。"""
        today = date.today()
        real_month = current_month_key(today)
        records = self.store.all_records()

        # 总览、预算栏始终反映“真实本月”，不随查看月份变化
        budget = self.store.budget_amount_for(real_month)

        # --- 预算输入框回显（避免覆盖用户正在输入的内容：仅当与现值不同时写入） ---
        budget_text = "" if budget == 0 else f"{budget:.2f}".rstrip("0").rstrip(".")
        if self.var_budget.get() != budget_text:
            self.var_budget.set(budget_text)
        self.var_threshold.set(str(round(self.store.threshold_for(real_month) * 100)))

        # --- 总览指标（统计函数内部会自动只算消费） ---
        summary = summarize_month(records, budget, today, real_month)
        self.lbl_month_spent.config(text=f"{summary['month_spent']:.2f}")
        self.lbl_remaining.config(text=f"{summary['remaining']:.2f}")
        self.lbl_today_spent.config(text=f"{summary['today_spent']:.2f}")
        self.lbl_remaining_days.config(text=str(summary["remaining_days"]))
        if summary["suggested_daily"] is None:
            self.lbl_suggested.config(text="--")
        else:
            self.lbl_suggested.config(text=f"{summary['suggested_daily']:.2f}")

        # --- 顶部彩色提醒条 ---
        self._refresh_alert(budget, summary)

        # --- 查看月份切换条：月份文字 + “下一月”按钮可用性 ---
        view_month = self.var_view_month.get()
        year, month = map(int, view_month.split("-"))
        if view_month == real_month:
            self.lbl_view_month.config(text=f"{year} 年 {month} 月")
            self.btn_next_month.state(["disabled"])
        else:
            self.lbl_view_month.config(text=f"{year} 年 {month} 月（历史）")
            self.btn_next_month.state(["!disabled"])

        # --- 明细表：只展示查看月份内的记录（消费与存入在一起，倒序） ---
        self.tree_records.delete(*self.tree_records.get_children())
        for r in records_in_month(records, view_month):
            if r["kind"] == KIND_DEPOSIT:
                tags = ("deposit",)
                category_text = "—"          # 存入没有分类
            else:
                tags = ()
                category_text = r["category"]
            self.tree_records.insert(
                "", "end", iid=r["id"],
                values=(
                    r["date"], r["kind"], category_text,
                    f"{r['amount']:.2f}", r["note"],
                ),
                tags=tags,
            )

        # --- 每日统计表：查看月份 + 该月预算；历史月自然没有“今天”高亮 ---
        month_budget = self.store.budget_amount_for(view_month)
        self.tree_daily.delete(*self.tree_daily.get_children())
        today_str = today.strftime(DATE_FMT)
        for cur, weekday, day_spent, cumulative, balance in build_daily_rows(
            records, month_budget, today, view_month
        ):
            tags = []
            if cur.strftime(DATE_FMT) == today_str:
                tags.append("today")
            if balance < 0:
                tags.append("negative")
            self.tree_daily.insert(
                "", "end",
                values=(
                    cur.strftime(DATE_FMT), weekday,
                    f"{day_spent:.2f}", f"{cumulative:.2f}", f"{balance:.2f}",
                ),
                tags=tags,
            )

        # --- 分析图：按查看月份重绘 ---
        self._draw_chart()

    def _refresh_alert(self, budget: float, summary: dict):
        """根据预算使用率更新提醒条的文字与颜色。"""
        if budget <= 0:
            self.lbl_alert.config(
                text="尚未设置本月生活费预算，请先在顶部填写预算与预警比例。",
                bg=COLOR_IDLE,
            )
            return

        ratio = summary["month_spent"] / budget
        ratio_text = f"已使用预算的 {ratio * 100:.1f}%"

        if ratio >= 1.0:
            self.lbl_alert.config(
                text=f"⚠ 已超支！{ratio_text}，超出 {-summary['remaining']:.2f} 元，请立刻控制消费。",
                bg=COLOR_OVER,
            )
        elif ratio >= self.store.alert_threshold:
            self.lbl_alert.config(
                text=f"⚠ 额度预警：{ratio_text}，剩余 {summary['remaining']:.2f} 元，"
                     f"剩余 {summary['remaining_days']} 天，建议日均 "
                     f"{summary['suggested_daily']:.2f} 元以内。",
                bg=COLOR_WARN,
            )
        else:
            self.lbl_alert.config(
                text=f"✓ 预算使用正常：{ratio_text}，剩余 {summary['remaining']:.2f} 元，继续保持～",
                bg=COLOR_OK,
            )

    # =================================================================
    # 七、分析图绘制（Canvas 手绘，零第三方依赖）
    # =================================================================

    def _on_chart_configure(self, event):
        """画布尺寸变化（窗口拖动）时，按新尺寸重绘一次。"""
        if (event.width, event.height) != self._chart_size:
            self._draw_chart()

    def _draw_chart(self):
        """按查看月份绘制各分类消费金额的垂直条形图。"""
        canvas = self.canvas_chart
        w = canvas.winfo_width()
        h = canvas.winfo_height()
        if w <= 1 or h <= 1:
            return  # 窗口尚未完成布局，等 Configure 事件触发后再画
        canvas.delete("all")
        self._chart_size = (w, h)

        month_key = self.var_view_month.get()
        totals = category_totals(self.store.all_records(), month_key)
        deposits = deposit_total(self.store.all_records(), month_key)
        max_value = max(totals.values())

        # 绘图区边距：左侧留给纵轴刻度，上下留给标题与分类名
        left, right, top, bottom = 72, 30, 56, 78
        plot_w = w - left - right
        plot_h = h - top - bottom
        baseline_y = top + plot_h

        # 标题
        canvas.create_text(
            w / 2, 26, text=f"{month_key} 各分类消费金额（元）",
            font=("微软雅黑", 13, "bold"), fill="#333333",
        )

        # 基线
        canvas.create_line(left, baseline_y, w - right, baseline_y,
                           fill="#9e9e9e", width=2)

        # 横向网格线 + 纵轴金额刻度
        if max_value > 0:
            for frac in (0.25, 0.5, 0.75, 1.0):
                grid_y = baseline_y - plot_h * frac
                canvas.create_line(left, grid_y, w - right, grid_y, fill="#eeeeee")
                canvas.create_text(
                    left - 8, grid_y, anchor="e",
                    text=f"{max_value * frac:.0f}",
                    fill="#9e9e9e", font=("微软雅黑", 8),
                )
        else:
            canvas.create_text(
                w / 2, top + plot_h / 2,
                text="这个月还没有消费记录",
                fill="#bdbdbd", font=("微软雅黑", 12),
            )

        # 四个分类各占一个槽位，柱宽不超过槽宽的 55%、且不超过 90px
        n = len(CATEGORIES)
        slot = plot_w / n
        bar_w = min(90, slot * 0.55)
        # 与四类对应的区分色
        bar_colors = ["#1976d2", "#388e3c", "#f57c00", "#7b1fa2"]

        for i, cat in enumerate(CATEGORIES):
            value = totals.get(cat, 0.0)
            cx = left + slot * i + slot / 2
            bar_h = (value / max_value) * plot_h if max_value > 0 else 0
            x0 = cx - bar_w / 2
            x1 = cx + bar_w / 2
            y0 = baseline_y - bar_h
            # 柱子（圆角不做，保持简单）；金额标签在柱顶，极矮的柱子挪到基线之上
            canvas.create_rectangle(x0, y0, x1, baseline_y,
                                    fill=bar_colors[i], outline="")
            label_y = y0 - 10 if bar_h >= 20 else baseline_y - 10
            canvas.create_text(
                cx, label_y, text=f"{value:.2f}",
                fill="#333333", font=("微软雅黑", 9, "bold"),
            )
            # 分类名（基线下方）
            canvas.create_text(
                cx, baseline_y + 20, text=cat,
                fill="#333333", font=("微软雅黑", 10),
            )

        # 底部附注：本月存入合计（口径提示，避免与消费混淆）
        canvas.create_text(
            left, baseline_y + 48, anchor="w",
            text=f"该月存入合计：{deposits:.2f} 元（存入不计入消费统计）",
            fill=COLOR_OK, font=("微软雅黑", 9),
        )


# =================================================================
# 八、程序入口
# =================================================================
def main():
    app = BillTrackerApp()
    app.mainloop()


if __name__ == "__main__":
    main()
