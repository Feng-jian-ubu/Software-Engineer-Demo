/**
 * tests/tracker.test.js
 * src/tracker.js 纯业务逻辑单元测试（node:test + node:assert/strict）
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORD_TYPE,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  categoriesOf,
  round2,
  toCents,
  fromCents,
  formatMoney,
  isValidDateStr,
  isValidMonthStr,
  monthOf,
  createRecord,
  addRecord,
  deleteRecord,
  sortRecords,
  filterByMonth,
  filterByDate,
  calcTotals,
  calcBalance,
  calcMonthlyTotals,
  statsByCategory,
  monthlyExpenseStats,
  checkBudget,
} from '../src/tracker.js';

/** 快速构造合法记录（默认支出 10 元餐饮） */
function mk(over = {}) {
  return createRecord({
    type: RECORD_TYPE.EXPENSE,
    amount: 10,
    category: '餐饮',
    date: '2025-03-05',
    ...over,
  });
}

/* ================= 金额精度工具 ================= */

describe('金额精度：round2 / toCents / fromCents / formatMoney', () => {
  test('round2 修正 0.1 + 0.2 浮点误差', () => {
    assert.equal(0.1 + 0.2 === 0.3, false); // 证明原生浮点确实有误差
    assert.equal(round2(0.1 + 0.2), 0.3);
  });

  test('round2 处理 1.005 / 2.675 边界舍入', () => {
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(2.675), 2.68);
  });

  test('round2 常规值与字符串数字', () => {
    assert.equal(round2(19.99), 19.99);
    assert.equal(round2('12.34'), 12.34);
    assert.equal(round2(5), 5);
  });

  test('round2 非法输入返回 NaN', () => {
    assert.ok(Number.isNaN(round2('abc')));
    assert.ok(Number.isNaN(round2(NaN)));
    assert.ok(Number.isNaN(round2(Infinity)));
    assert.ok(Number.isNaN(round2(undefined)));
  });

  test('toCents 元转分为整数', () => {
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(toCents(19.99), 1999);
    assert.equal(toCents(1), 100);
    assert.equal(toCents(0.07), 7);
    assert.ok(Number.isNaN(toCents('abc')));
  });

  test('fromCents 分转元保留两位小数', () => {
    assert.equal(fromCents(30), 0.3);
    assert.equal(fromCents(1999), 19.99);
    assert.equal(fromCents(0), 0);
    assert.equal(fromCents(105), 1.05);
    assert.ok(Number.isNaN(fromCents('x')));
  });

  test('元->分->元 往返无损', () => {
    for (const v of [0.01, 0.3, 2.68, 999.99, 123456.78]) {
      assert.equal(fromCents(toCents(v)), v);
    }
  });

  test('formatMoney 输出两位小数字符串，非法输入兜底 0.00', () => {
    assert.equal(formatMoney(0.1 + 0.2), '0.30');
    assert.equal(formatMoney(5), '5.00');
    assert.equal(formatMoney('abc'), '0.00');
  });
});

/* ================= 日期工具 ================= */

describe('日期工具：isValidDateStr / isValidMonthStr / monthOf', () => {
  test('isValidDateStr 接受真实日期（含闰年 2-29）', () => {
    assert.equal(isValidDateStr('2024-02-29'), true); // 2024 是闰年
    assert.equal(isValidDateStr('2025-01-31'), true);
  });

  test('isValidDateStr 拒绝不存在的日期与非法格式', () => {
    assert.equal(isValidDateStr('2025-02-29'), false); // 2025 非闰年
    assert.equal(isValidDateStr('2025-04-31'), false);
    assert.equal(isValidDateStr('2025-13-01'), false);
    assert.equal(isValidDateStr('2025/03/01'), false);
    assert.equal(isValidDateStr('2025-3-1'), false);
    assert.equal(isValidDateStr(20250301), false);
    assert.equal(isValidDateStr(null), false);
  });

  test('isValidMonthStr 校验 YYYY-MM', () => {
    assert.equal(isValidMonthStr('2025-01'), true);
    assert.equal(isValidMonthStr('2025-12'), true);
    assert.equal(isValidMonthStr('2025-00'), false);
    assert.equal(isValidMonthStr('2025-13'), false);
    assert.equal(isValidMonthStr('2025-1'), false);
  });

  test('monthOf 提取月份', () => {
    assert.equal(monthOf('2025-03-05'), '2025-03');
    assert.equal(monthOf(123), '');
  });
});

/* ================= createRecord 校验 ================= */

describe('createRecord 校验', () => {
  test('合法输入创建支出记录并规范化字段', () => {
    const r = createRecord({
      type: 'expense',
      amount: 25.5,
      category: '餐饮',
      date: '2025-03-01',
      note: '  午饭  ',
    });
    assert.equal(r.type, 'expense');
    assert.equal(r.amount, 25.5);
    assert.equal(r.category, '餐饮');
    assert.equal(r.date, '2025-03-01');
    assert.equal(r.note, '午饭'); // trim
    assert.equal(typeof r.id, 'string');
    assert.ok(r.id.length > 0);
    assert.equal(typeof r.createdAt, 'number');
  });

  test('合法输入创建收入记录', () => {
    const r = createRecord({
      type: 'income',
      amount: '3000',
      category: '生活费',
      date: '2025-03-01',
    });
    assert.equal(r.amount, 3000);
    assert.equal(r.note, '');
  });

  test('保留外部传入的合法 id 与 createdAt', () => {
    const r = mk({ id: 'fixed-id-1', createdAt: 1700000000000 });
    assert.equal(r.id, 'fixed-id-1');
    assert.equal(r.createdAt, 1700000000000);
  });

  test('金额收敛两位小数，杜绝浮点误差入库', () => {
    const r = mk({ amount: 0.1 + 0.2 });
    assert.equal(r.amount, 0.3);
  });

  test('note 超长截断到 50 字符，非字符串 note 归一化为空串', () => {
    const long = mk({ note: 'a'.repeat(60) });
    assert.equal(long.note.length, 50);
    assert.equal(mk({ note: 123 }).note, '');
  });

  test('拒绝金额为 0 / 负数 / NaN / 非数字', () => {
    const base = { type: 'expense', category: '餐饮', date: '2025-03-01' };
    assert.throws(() => createRecord({ ...base, amount: 0 }), /金额必须是大于 0/);
    assert.throws(() => createRecord({ ...base, amount: -5 }), /金额必须是大于 0/);
    assert.throws(() => createRecord({ ...base, amount: NaN }), /金额必须是大于 0/);
    assert.throws(() => createRecord({ ...base, amount: 'abc' }), /金额必须是大于 0/);
    assert.throws(() => createRecord({ ...base, amount: undefined }), /金额必须是大于 0/);
  });

  test('拒绝金额超出上限（>1e7），边界 1e7 放行', () => {
    const base = { type: 'expense', category: '餐饮', date: '2025-03-01' };
    assert.throws(() => createRecord({ ...base, amount: 10000000.01 }), /超出合理范围/);
    assert.equal(createRecord({ ...base, amount: 10000000 }).amount, 10000000);
  });

  test('拒绝非法日期（如 2025-02-29 平年）', () => {
    const base = { type: 'expense', amount: 10, category: '餐饮' };
    assert.throws(() => createRecord({ ...base, date: '2025-02-29' }), /有效日期/);
    assert.throws(() => createRecord({ ...base, date: '2025/03/01' }), /有效日期/);
    assert.throws(() => createRecord({ ...base, date: '' }), /有效日期/);
    // 闰年对照组应通过
    assert.equal(createRecord({ ...base, date: '2024-02-29' }).date, '2024-02-29');
  });

  test('拒绝非法分类（支出/收入分类互不通用）', () => {
    assert.throws(
      () => createRecord({ type: 'expense', amount: 10, category: '生活费', date: '2025-03-01' }),
      /不是合法的支出分类/,
    );
    assert.throws(
      () => createRecord({ type: 'income', amount: 10, category: '餐饮', date: '2025-03-01' }),
      /不是合法的收入分类/,
    );
  });

  test('拒绝非法记录类型', () => {
    assert.throws(
      () => createRecord({ type: 'other', amount: 10, category: '其他', date: '2025-03-01' }),
      /expense/,
    );
    assert.throws(() => createRecord(), /expense/);
  });

  test('categoriesOf 返回副本，外部修改不影响内部常量', () => {
    const cats = categoriesOf('expense');
    cats.push('hack');
    assert.deepEqual(categoriesOf('expense'), [...EXPENSE_CATEGORIES]);
    assert.deepEqual(categoriesOf('income'), [...INCOME_CATEGORIES]);
    assert.deepEqual(categoriesOf('unknown'), []);
  });
});

/* ================= addRecord / deleteRecord / sortRecords ================= */

describe('addRecord / deleteRecord / sortRecords 不可变性', () => {
  test('addRecord 返回新数组且不修改原数组', () => {
    const r1 = mk({ id: 'a1' });
    const r2 = mk({ id: 'a2' });
    const original = [r1];
    const next = addRecord(original, r2);
    assert.notEqual(next, original);
    assert.equal(original.length, 1);
    assert.equal(next.length, 2);
    assert.deepEqual(next, [r1, r2]);
  });

  test('addRecord 拒绝非数组与无 id 记录', () => {
    assert.throws(() => addRecord(null, mk()), TypeError);
    assert.throws(() => addRecord('x', mk()), TypeError);
    assert.throws(() => addRecord([], { amount: 1 }), /缺少 id/);
    assert.throws(() => addRecord([], null), /不合法/);
  });

  test('deleteRecord 按 id 删除且不修改原数组', () => {
    const r1 = mk({ id: 'd1' });
    const r2 = mk({ id: 'd2' });
    const original = [r1, r2];
    const next = deleteRecord(original, 'd1');
    assert.notEqual(next, original);
    assert.equal(original.length, 2);
    assert.deepEqual(next, [r2]);
  });

  test('deleteRecord 删除不存在的 id 返回等长新数组', () => {
    const original = [mk({ id: 'd1' })];
    const next = deleteRecord(original, 'not-exist');
    assert.notEqual(next, original);
    assert.equal(next.length, 1);
  });

  test('deleteRecord 拒绝非数组', () => {
    assert.throws(() => deleteRecord(undefined, 'x'), TypeError);
  });

  test('sortRecords 日期倒序、同日按创建时间倒序，且不改原数组', () => {
    const a = mk({ id: 's1', date: '2025-03-01', createdAt: 100 });
    const b = mk({ id: 's2', date: '2025-03-05', createdAt: 100 });
    const c = mk({ id: 's3', date: '2025-03-05', createdAt: 200 });
    const original = [a, b, c];
    const sorted = sortRecords(original);
    assert.deepEqual(sorted.map((r) => r.id), ['s3', 's2', 's1']);
    assert.deepEqual(original.map((r) => r.id), ['s1', 's2', 's3']); // 原数组顺序不变
  });
});

/* ================= 筛选 ================= */

describe('filterByMonth / filterByDate 月度与日期筛选', () => {
  const records = [
    mk({ id: 'f1', date: '2025-01-31' }),
    mk({ id: 'f2', date: '2025-02-01' }),
    mk({ id: 'f3', date: '2025-02-28' }),
    mk({ id: 'f4', date: '2025-03-01' }),
  ];

  test('filterByMonth 精确按月筛选，跨月边界不串月', () => {
    assert.deepEqual(filterByMonth(records, '2025-02').map((r) => r.id), ['f2', 'f3']);
    assert.deepEqual(filterByMonth(records, '2025-01').map((r) => r.id), ['f1']);
    assert.deepEqual(filterByMonth(records, '2025-04'), []);
  });

  test('filterByMonth 空 month 返回全部副本（新数组引用）', () => {
    const all = filterByMonth(records, '');
    assert.notEqual(all, records);
    assert.deepEqual(all, records);
  });

  test('filterByDate 精确匹配具体日期', () => {
    assert.deepEqual(filterByDate(records, '2025-02-01').map((r) => r.id), ['f2']);
    assert.deepEqual(filterByDate(records, '2025-12-31'), []);
  });

  test('filterByDate 空 date 返回全部副本', () => {
    const all = filterByDate(records, null);
    assert.notEqual(all, records);
    assert.equal(all.length, records.length);
  });

  test('筛选函数拒绝非数组入参', () => {
    assert.throws(() => filterByMonth(null, '2025-02'), TypeError);
    assert.throws(() => filterByDate({}, '2025-02-01'), TypeError);
  });
});

/* ================= 收支合计 / 余额 ================= */

describe('calcTotals / calcBalance / calcMonthlyTotals', () => {
  test('混合收支：收入 3000，支出 25.5 + 14.5 = 40，余额 2960', () => {
    const records = [
      mk({ type: 'income', amount: 3000, category: '生活费', date: '2025-03-01' }),
      mk({ amount: 25.5, date: '2025-03-02' }),
      mk({ amount: 14.5, category: '交通', date: '2025-03-03' }),
    ];
    const totals = calcTotals(records);
    assert.equal(totals.income, 3000);
    assert.equal(totals.expense, 40);
    assert.equal(totals.balance, 2960);
    assert.equal(calcBalance(records), 2960);
  });

  test('空数组合计全为 0', () => {
    assert.deepEqual(calcTotals([]), { income: 0, expense: 0, balance: 0 });
    assert.equal(calcBalance([]), 0);
  });

  test('多笔浮点金额累加无精度误差（0.1+0.2+0.3=0.6）', () => {
    const records = [
      mk({ amount: 0.1 }),
      mk({ amount: 0.2 }),
      mk({ amount: 0.3 }),
      mk({ type: 'income', amount: 1, category: '兼职' }),
    ];
    const totals = calcTotals(records);
    assert.equal(totals.expense, 0.6);
    assert.equal(totals.balance, 0.4);
  });

  test('跳过 null 与金额非法的脏数据条目', () => {
    const records = [
      null,
      undefined,
      { id: 'x', type: 'expense', amount: 'abc', category: '餐饮', date: '2025-03-01' },
      mk({ id: 'ok', amount: 20 }),
    ];
    assert.equal(calcTotals(records).expense, 20);
  });

  test('calcMonthlyTotals 只统计指定月份', () => {
    const records = [
      mk({ amount: 10, date: '2025-01-31' }),
      mk({ amount: 20, date: '2025-02-01' }),
      mk({ type: 'income', amount: 100, category: '奖学金', date: '2025-02-10' }),
    ];
    assert.deepEqual(calcMonthlyTotals(records, '2025-02'), {
      income: 100,
      expense: 20,
      balance: 80,
    });
    assert.deepEqual(calcMonthlyTotals(records, '2025-03'), {
      income: 0,
      expense: 0,
      balance: 0,
    });
  });
});

/* ================= 分类统计 ================= */

describe('statsByCategory 分类统计', () => {
  test('按分类汇总金额、计算百分比并按金额降序', () => {
    const records = [
      mk({ amount: 10, category: '餐饮' }),
      mk({ amount: 20, category: '餐饮' }),
      mk({ amount: 10, category: '娱乐' }),
      mk({ amount: 40, category: '交通' }),
    ];
    const stats = statsByCategory(records, 'expense');
    assert.deepEqual(stats, [
      { category: '交通', amount: 40, percent: 50 },
      { category: '餐饮', amount: 30, percent: 37.5 },
      { category: '娱乐', amount: 10, percent: 12.5 },
    ]);
    const sum = stats.reduce((s, x) => s + x.percent, 0);
    assert.ok(Math.abs(sum - 100) < 1e-9);
  });

  test('默认按支出统计，收入记录不计入', () => {
    const records = [
      mk({ amount: 10, category: '餐饮' }),
      mk({ type: 'income', amount: 500, category: '生活费' }),
    ];
    const stats = statsByCategory(records);
    assert.equal(stats.length, 1);
    assert.equal(stats[0].category, '餐饮');
  });

  test('收入类型统计正常工作', () => {
    const records = [
      mk({ type: 'income', amount: 100, category: '生活费' }),
      mk({ type: 'income', amount: 100, category: '兼职' }),
      mk({ amount: 999, category: '购物' }),
    ];
    const stats = statsByCategory(records, 'income');
    assert.equal(stats.length, 2);
    for (const s of stats) assert.equal(s.percent, 50);
  });

  test('空数据返回空数组', () => {
    assert.deepEqual(statsByCategory([], 'expense'), []);
    assert.deepEqual(statsByCategory([mk({ type: 'income', amount: 1, category: '其他' })], 'expense'), []);
  });
});

/* ================= monthlyExpenseStats 本月支出柱状图数据 ================= */

describe('monthlyExpenseStats 本月支出分类统计', () => {
  test('只统计指定月份的支出，按金额降序并含正确百分比', () => {
    const records = [
      mk({ amount: 10, category: '餐饮', date: '2025-03-05' }),
      mk({ amount: 20, category: '餐饮', date: '2025-03-10' }),
      mk({ amount: 40, category: '交通', date: '2025-03-15' }),
      mk({ amount: 999, category: '娱乐', date: '2025-04-01' }), // 其他月份不计入
    ];
    const stats = monthlyExpenseStats(records, '2025-03');
    assert.equal(stats.length, 2);
    assert.equal(stats[0].category, '交通');
    assert.equal(stats[0].amount, 40);
    assert.equal(stats[0].percent, 57.14); // 4000/7000*100
    assert.equal(stats[1].category, '餐饮');
    assert.equal(stats[1].amount, 30);
    assert.equal(stats[1].percent, 42.86); // 3000/7000*100
  });

  test('收入记录与其他月份记录不计入', () => {
    const records = [
      mk({ type: 'income', amount: 3000, category: '生活费', date: '2025-03-01' }),
      mk({ amount: 25.5, category: '餐饮', date: '2025-03-02' }),
      mk({ amount: 50, category: '购物', date: '2025-02-28' }),
    ];
    const stats = monthlyExpenseStats(records, '2025-03');
    assert.equal(stats.length, 1);
    assert.equal(stats[0].category, '餐饮');
    assert.equal(stats[0].amount, 25.5);
  });

  test('当月无支出返回空数组', () => {
    const records = [
      mk({ type: 'income', amount: 100, category: '兼职', date: '2025-03-01' }),
      mk({ amount: 10, date: '2025-02-01' }),
    ];
    assert.deepEqual(monthlyExpenseStats(records, '2025-03'), []);
    assert.deepEqual(monthlyExpenseStats([], '2025-03'), []);
  });

  test('多笔浮点金额同分类累加无精度误差', () => {
    const records = [
      mk({ amount: 0.1, category: '日用', date: '2025-03-01' }),
      mk({ amount: 0.2, category: '日用', date: '2025-03-02' }),
    ];
    const stats = monthlyExpenseStats(records, '2025-03');
    assert.equal(stats[0].amount, 0.3);
    assert.equal(stats[0].percent, 100);
  });

  test('拒绝非数组入参', () => {
    assert.throws(() => monthlyExpenseStats(null, '2025-03'), TypeError);
    assert.throws(() => monthlyExpenseStats(undefined, '2025-03'), TypeError);
  });
});

/* ================= checkBudget 预算检查 ================= */

describe('checkBudget 预算执行检查', () => {
  const month = '2025-03';
  const records = [
    mk({ amount: 250, category: '购物', date: '2025-03-05' }),
    mk({ amount: 150, category: '餐饮', date: '2025-03-10' }),
    mk({ amount: 999, category: '娱乐', date: '2025-04-01' }), // 其他月份，不计入
  ];

  test('预算未启用：0 / 负数 / 非法值返回 enabled=false，spent 仍正确统计', () => {
    for (const budget of [0, -100, NaN, 'abc', undefined]) {
      const res = checkBudget(records, month, budget);
      assert.equal(res.enabled, false, `budget=${budget}`);
      assert.equal(res.spent, 400);
      assert.equal(res.remaining, 0);
      assert.equal(res.usage, 0);
      assert.equal(res.exceeded, false);
      assert.equal(res.overAmount, 0);
      assert.equal(res.month, month);
    }
  });

  test('正常预算：剩余、使用率、未超支', () => {
    const res = checkBudget(records, month, 1000);
    assert.equal(res.enabled, true);
    assert.equal(res.budget, 1000);
    assert.equal(res.spent, 400);
    assert.equal(res.remaining, 600);
    assert.equal(res.usage, 40);
    assert.equal(res.exceeded, false);
    assert.equal(res.overAmount, 0);
  });

  test('超支：remaining 钳到 0，overAmount 与 usage 正确', () => {
    const over = [mk({ amount: 350.5, category: '购物', date: '2025-03-05' })];
    const res = checkBudget(over, month, 300);
    assert.equal(res.exceeded, true);
    assert.equal(res.remaining, 0);
    assert.equal(res.overAmount, 50.5);
    assert.equal(res.usage, 116.83); // 35050/30000*100 = 116.8333...
  });

  test('支出恰好等于预算：不判超支，usage 精确为 100（浮点场景）', () => {
    const floatRecords = [
      mk({ amount: 0.1, date: '2025-03-01' }),
      mk({ amount: 0.2, date: '2025-03-02' }),
    ];
    const res = checkBudget(floatRecords, month, 0.3);
    assert.equal(res.spent, 0.3);
    assert.equal(res.usage, 100);
    assert.equal(res.exceeded, false);
    assert.equal(res.remaining, 0);
  });

  test('checkBudget 拒绝非数组入参', () => {
    assert.throws(() => checkBudget(null, month, 100), TypeError);
  });
});
