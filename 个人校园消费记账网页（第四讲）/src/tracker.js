/**
 * src/tracker.js
 * 记账应用纯业务逻辑模块
 * - 不依赖 DOM / 浏览器 API，可在 Node.js 环境直接 import（便于 node:test 单元测试）
 * - 金额内部统一换算为“分”（整数）参与运算，避免浮点精度问题
 * - 所有数组操作均为不可变操作（返回新数组），便于测试与状态管理
 */

/** 记录类型枚举 */
export const RECORD_TYPE = Object.freeze({
  EXPENSE: 'expense',
  INCOME: 'income',
});

/** 支出分类（大学生场景） */
export const EXPENSE_CATEGORIES = Object.freeze([
  '餐饮', '学习资料', '娱乐', '交通', '购物', '日用', '其他',
]);

/** 收入分类（大学生场景） */
export const INCOME_CATEGORIES = Object.freeze([
  '生活费', '兼职', '奖学金', '其他',
]);

/** 月份格式：YYYY-MM */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 日期格式：YYYY-MM-DD */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 根据记录类型返回可选分类列表（返回副本，防止外部修改） */
export function categoriesOf(type) {
  if (type === RECORD_TYPE.EXPENSE) return [...EXPENSE_CATEGORIES];
  if (type === RECORD_TYPE.INCOME) return [...INCOME_CATEGORIES];
  return [];
}

/* ---------------- 金额精度工具 ---------------- */

/** 四舍五入保留两位小数（元）；非法输入返回 NaN */
export function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  // 加 Number.EPSILON 修正 1.005 之类的边界舍入问题
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 元 -> 分（整数）；非法输入返回 NaN */
export function toCents(value) {
  const n = round2(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** 分 -> 元（保留两位小数） */
export function fromCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n) / 100;
}

/** 格式化为两位小数字符串（纯展示用，无 DOM 依赖） */
export function formatMoney(value) {
  const n = round2(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

/* ---------------- 日期工具 ---------------- */

/** 判断是否为真实存在的 YYYY-MM-DD 日期 */
export function isValidDateStr(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 判断是否为合法的 YYYY-MM 月份串 */
export function isValidMonthStr(month) {
  return typeof month === 'string' && MONTH_RE.test(month);
}

/** 返回 YYYY-MM-DD（默认今天，可注入时钟便于测试） */
export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 返回 YYYY-MM（默认当月，可注入时钟便于测试） */
export function currentMonth(now = new Date()) {
  return todayStr(now).slice(0, 7);
}

/** 从日期串提取月份：YYYY-MM-DD -> YYYY-MM */
export function monthOf(dateStr) {
  return typeof dateStr === 'string' ? dateStr.slice(0, 7) : '';
}

/* ---------------- ID 生成 ---------------- */

let idSeq = 0;

/** 生成唯一记录 ID（时间戳 + 自增序号 + 随机串，避免同毫秒冲突） */
export function generateId() {
  idSeq += 1;
  return `r_${Date.now().toString(36)}_${idSeq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- 内部校验 ---------------- */

function assertRecordArray(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('records 必须是数组');
  }
}

/* ---------------- 记录操作（不可变） ---------------- */

/**
 * 创建一条规范化记录
 * @param {{id?:string, type:string, amount:number|string, category:string, date:string, note?:string, createdAt?:number}} input
 * @returns {{id:string, type:string, amount:number, category:string, date:string, note:string, createdAt:number}}
 * @throws {Error} 参数非法时抛出中文错误信息
 */
export function createRecord(input = {}) {
  const { type, amount, category, date, note = '', id, createdAt } = input;

  if (type !== RECORD_TYPE.EXPENSE && type !== RECORD_TYPE.INCOME) {
    throw new Error('记录类型必须是 expense（支出）或 income（收入）');
  }
  // 金额统一收敛为两位小数的元，杜绝 0.1+0.2 类浮点误差进入存储
  const amountYuan = round2(amount);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    throw new Error('金额必须是大于 0 的数字');
  }
  // 单笔金额上限：1e7 元，超出视为异常输入
  if (amountYuan > 1e7) {
    throw new Error('金额超出合理范围');
  }
  if (!categoriesOf(type).includes(category)) {
    throw new Error(`“${category}”不是合法的${type === RECORD_TYPE.EXPENSE ? '支出' : '收入'}分类`);
  }
  if (!isValidDateStr(date)) {
    throw new Error('日期必须是 YYYY-MM-DD 格式的有效日期');
  }

  return {
    id: typeof id === 'string' && id ? id : generateId(),
    type,
    amount: amountYuan,
    category,
    date,
    note: typeof note === 'string' ? note.trim().slice(0, 50) : '',
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

/** 追加记录，返回新数组 */
export function addRecord(records, record) {
  assertRecordArray(records);
  if (!record || typeof record !== 'object' || !record.id) {
    throw new Error('待添加的记录不合法（缺少 id）');
  }
  return [...records, record];
}

/** 按 id 删除记录，返回新数组 */
export function deleteRecord(records, id) {
  assertRecordArray(records);
  return records.filter((r) => r.id !== id);
}

/** 排序：日期倒序，同日按创建时间倒序；返回新数组 */
export function sortRecords(records) {
  assertRecordArray(records);
  return [...records].sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    if (byDate !== 0) return byDate;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

/* ---------------- 筛选 ---------------- */

/** 按月份筛选（month 为 YYYY-MM；为空则返回全部副本） */
export function filterByMonth(records, month) {
  assertRecordArray(records);
  if (!month) return [...records];
  return records.filter((r) => typeof r.date === 'string' && r.date.startsWith(month));
}

/** 按具体日期筛选（date 为 YYYY-MM-DD；为空则返回全部副本） */
export function filterByDate(records, date) {
  assertRecordArray(records);
  if (!date) return [...records];
  return records.filter((r) => r.date === date);
}

/* ---------------- 统计 ---------------- */

/**
 * 计算收支合计（内部分累加，最后一次性换算回元）
 * @returns {{income:number, expense:number, balance:number}} 单位：元
 */
export function calcTotals(records) {
  assertRecordArray(records);
  let incomeCents = 0;
  let expenseCents = 0;
  for (const r of records) {
    if (!r) continue;
    const cents = toCents(r.amount);
    if (!Number.isFinite(cents)) continue; // 跳过金额异常的脏数据
    if (r.type === RECORD_TYPE.INCOME) incomeCents += cents;
    else if (r.type === RECORD_TYPE.EXPENSE) expenseCents += cents;
  }
  return {
    income: fromCents(incomeCents),
    expense: fromCents(expenseCents),
    balance: fromCents(incomeCents - expenseCents),
  };
}

/** 计算账内余额（收入 - 支出） */
export function calcBalance(records) {
  return calcTotals(records).balance;
}

/** 计算某月（YYYY-MM）的收支合计 */
export function calcMonthlyTotals(records, month) {
  return calcTotals(filterByMonth(records, month));
}

/**
 * 按分类统计金额与占比
 * @param {string} type expense 或 income
 * @returns {Array<{category:string, amount:number, percent:number}>} 按金额降序，percent 范围 0-100
 */
export function statsByCategory(records, type = RECORD_TYPE.EXPENSE) {
  assertRecordArray(records);
  const centsByCategory = new Map();
  let totalCents = 0;
  for (const r of records) {
    if (!r || r.type !== type) continue;
    const cents = toCents(r.amount);
    if (!Number.isFinite(cents)) continue;
    centsByCategory.set(r.category, (centsByCategory.get(r.category) || 0) + cents);
    totalCents += cents;
  }
  const result = [];
  for (const [category, cents] of centsByCategory.entries()) {
    result.push({
      category,
      amount: fromCents(cents),
      percent: totalCents === 0 ? 0 : round2((cents / totalCents) * 100),
    });
  }
  result.sort((a, b) => b.amount - a.amount);
  return result;
}

/**
 * 检查某月预算执行情况
 * @param {Array} records 全量记录
 * @param {string} month YYYY-MM
 * @param {number|string} budget 月预算（元），<=0 或非法视为未设置
 * @returns {{enabled:boolean, month:string, budget:number, spent:number, remaining:number, usage:number, exceeded:boolean, overAmount:number}}
 *   enabled=false 表示未设置预算；usage 为已用百分比；exceeded 表示已超支；overAmount 为超支金额
 */
export function checkBudget(records, month, budget) {
  assertRecordArray(records);
  const budgetYuan = round2(budget);
  const { expense: spent } = calcMonthlyTotals(records, month);
  if (!Number.isFinite(budgetYuan) || budgetYuan <= 0) {
    return { enabled: false, month, budget: 0, spent, remaining: 0, usage: 0, exceeded: false, overAmount: 0 };
  }
  const exceeded = spent > budgetYuan;
  return {
    enabled: true,
    month,
    budget: budgetYuan,
    spent,
    // 超支时剩余钳到 0，超出的金额由 overAmount 单独表达
    remaining: exceeded ? 0 : round2(budgetYuan - spent),
    // 用分做除法，进一步规避浮点误差
    usage: round2((toCents(spent) / toCents(budgetYuan)) * 100),
    exceeded,
    overAmount: exceeded ? round2(spent - budgetYuan) : 0,
  };
}

/**
 * 统计某月各支出分类的消费金额（供“本月支出柱状图”面板使用）
 * 内部直接复用 filterByMonth + statsByCategory，保证月份过滤与分类聚合口径唯一，
 * UI 层无需重复实现计算逻辑
 * @param {Array} records 全量记录
 * @param {string} month YYYY-MM
 * @returns {Array<{category:string, amount:number, percent:number}>} 按金额降序
 */
export function monthlyExpenseStats(records, month) {
  return statsByCategory(filterByMonth(records, month), RECORD_TYPE.EXPENSE);
}
