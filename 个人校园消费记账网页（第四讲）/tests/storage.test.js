/**
 * tests/storage.test.js
 * src/storage.js 持久化封装单元测试（node:test + node:assert/strict）
 * Node 环境无 localStorage，模块自动降级为内存存储；
 * 另通过注入 globalThis.localStorage mock 覆盖“浏览器存储”与脏 JSON 分支。
 */
import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRecords,
  saveRecords,
  loadBudgets,
  saveBudgets,
  getBudget,
  setBudget,
  clearAll,
} from '../src/storage.js';
import { createRecord } from '../src/tracker.js';

/** 构造一条合法记录 */
function mkRecord(over = {}) {
  return createRecord({
    id: 'rec-1',
    type: 'expense',
    amount: 25.5,
    category: '餐饮',
    date: '2025-03-05',
    note: '午饭',
    createdAt: 1700000000000,
    ...over,
  });
}

/* ================= 内存降级路径 ================= */

describe('storage：Node 内存降级存储', () => {
  beforeEach(() => clearAll());

  test('初始状态 loadRecords 返回空数组', () => {
    assert.deepEqual(loadRecords(), []);
  });

  test('saveRecords / loadRecords 往返一致（id 与 createdAt 保留）', () => {
    const records = [mkRecord(), mkRecord({ id: 'rec-2', amount: 0.3, note: '' })];
    assert.equal(saveRecords(records), true);
    const loaded = loadRecords();
    assert.deepEqual(loaded, records);
  });

  test('loadRecords 过滤脏数据：null / 非法元素被丢弃，合法元素保留', () => {
    const good = mkRecord({ id: 'good' });
    const dirty = [
      null,
      42,
      'not-a-record',
      { id: 'bad-amount', type: 'expense', amount: -5, category: '餐饮', date: '2025-03-01' },
      { id: 'bad-date', type: 'expense', amount: 10, category: '餐饮', date: '2025-02-29' },
      { id: 'bad-cat', type: 'income', amount: 10, category: '餐饮', date: '2025-03-01' },
      good,
    ];
    saveRecords(dirty);
    const loaded = loadRecords();
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], good);
  });

  test('saveRecords 入参非数组时按空数组保存', () => {
    assert.equal(saveRecords('not-array'), true);
    assert.deepEqual(loadRecords(), []);
  });

  test('预算读写往返：setBudget -> getBudget / loadBudgets', () => {
    assert.equal(getBudget('2025-03'), 0); // 未设置返回 0
    assert.equal(setBudget('2025-03', 800), true);
    assert.equal(getBudget('2025-03'), 800);
    assert.deepEqual(loadBudgets(), { '2025-03': 800 });
  });

  test('setBudget 金额保留两位小数', () => {
    setBudget('2025-03', 99.999);
    assert.equal(getBudget('2025-03'), 100);
  });

  test('setBudget 传 0 / 负数 / 非法值视为清除该月预算', () => {
    setBudget('2025-03', 500);
    assert.equal(getBudget('2025-03'), 500);
    setBudget('2025-03', 0);
    assert.equal(getBudget('2025-03'), 0);
    assert.deepEqual(loadBudgets(), {});

    setBudget('2025-04', 300);
    setBudget('2025-04', 'abc');
    assert.equal(getBudget('2025-04'), 0);
  });

  test('setBudget 非法月份返回 false', () => {
    assert.equal(setBudget('', 100), false);
    assert.equal(setBudget(null, 100), false);
    assert.equal(setBudget(202503, 100), false);
  });

  test('saveBudgets 拒绝数组/ null，归一化为 {}', () => {
    saveBudgets([1, 2]);
    assert.deepEqual(loadBudgets(), {});
    saveBudgets(null);
    assert.deepEqual(loadBudgets(), {});
  });

  test('clearAll 清空记录与预算', () => {
    saveRecords([mkRecord()]);
    setBudget('2025-03', 500);
    clearAll();
    assert.deepEqual(loadRecords(), []);
    assert.equal(getBudget('2025-03'), 0);
    assert.deepEqual(loadBudgets(), {});
  });
});

/* ================= 注入 localStorage mock 的浏览器路径 ================= */

describe('storage：localStorage 可用时的行为（mock 注入）', () => {
  /** 简单 localStorage mock */
  function installLocalStorageMock(initial = {}) {
    const map = new Map(Object.entries(initial));
    const mock = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      _map: map,
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mock,
      configurable: true,
      writable: true,
    });
    return mock;
  }

  after(() => {
    // 恢复为未定义，保证后续用例回到内存降级路径
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    clearAll();
  });

  test('localStorage 中 JSON 损坏时 loadRecords 兜底返回 []', () => {
    installLocalStorageMock({ 'billTracker.records.v1': '{{{not-json' });
    assert.deepEqual(loadRecords(), []);
  });

  test('localStorage 中数据非数组时 loadRecords 返回 []', () => {
    installLocalStorageMock({ 'billTracker.records.v1': '{"a":1}' });
    assert.deepEqual(loadRecords(), []);
  });

  test('localStorage 路径下 save/load 往返，且内存降级数据不串扰', () => {
    const mock = installLocalStorageMock();
    const records = [mkRecord({ id: 'ls-1' })];
    assert.equal(saveRecords(records), true);
    assert.deepEqual(loadRecords(), records);
    // 写入确实落到了 localStorage 而非内存
    assert.ok(mock._map.has('billTracker.records.v1'));
  });

  test('localStorage 中预算 JSON 损坏时 loadBudgets 兜底返回 {}', () => {
    installLocalStorageMock({ 'billTracker.budgets.v1': '###bad' });
    assert.deepEqual(loadBudgets(), {});
    assert.equal(getBudget('2025-03'), 0);
  });

  test('clearAll 同时清理 localStorage 与内存数据', () => {
    const mock = installLocalStorageMock();
    saveRecords([mkRecord()]);
    setBudget('2025-03', 100);
    clearAll();
    assert.equal(mock._map.has('billTracker.records.v1'), false);
    assert.equal(mock._map.has('billTracker.budgets.v1'), false);
    assert.deepEqual(loadRecords(), []);
  });
});
