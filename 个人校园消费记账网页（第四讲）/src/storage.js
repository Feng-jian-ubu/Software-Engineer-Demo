/**
 * src/storage.js
 * 数据持久化封装层
 * - 浏览器环境使用 localStorage 持久化
 * - 无 localStorage 的环境（如 Node.js 单测）自动退化为内存存储，保证模块可 import、可测试
 * - loadRecords 出口做逐条结构校验（复用 tracker.createRecord），脏数据直接丢弃，保证返回值永远是合法记录数组
 */
import { createRecord } from './tracker.js';

const RECORDS_KEY = 'billTracker.records.v1';
const BUDGETS_KEY = 'billTracker.budgets.v1';

/** 内存降级存储（Node.js / 隐私模式兜底） */
const memoryStore = new Map();

/** 获取可用的 storage 对象；不可用时返回 null */
function getStore() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage;
    }
  } catch (err) {
    // 某些浏览器隐私模式下访问 localStorage 会直接抛错
  }
  return null;
}

/** 读取并解析 JSON；任何异常都返回 fallback，保证 UI 不崩 */
function readJSON(key, fallback) {
  try {
    const store = getStore();
    const raw = store ? store.getItem(key) : memoryStore.get(key);
    if (raw == null) return fallback;
    const data = JSON.parse(raw);
    return data == null ? fallback : data;
  } catch (err) {
    return fallback;
  }
}

/** 写入 JSON；成功返回 true，失败返回 false */
function writeJSON(key, value) {
  try {
    const raw = JSON.stringify(value);
    const store = getStore();
    if (store) store.setItem(key, raw);
    else memoryStore.set(key, raw);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 逐条校验并规范化记录
 * - 复用 tracker.createRecord 做结构校验（类型/金额/分类/日期）
 * - 非法条目（如 null、字段缺失、金额越界等）直接丢弃，避免脏数据导致 UI 白屏
 */
function sanitizeRecords(list) {
  const valid = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    try {
      // createRecord 会保留合法 id/createdAt，并对 note 做归一化
      valid.push(createRecord(item));
    } catch (err) {
      // 忽略结构损坏的脏数据
    }
  }
  return valid;
}

/** 读取全部流水记录（始终返回合法记录数组，脏数据已过滤） */
export function loadRecords() {
  const data = readJSON(RECORDS_KEY, []);
  if (!Array.isArray(data)) return [];
  return sanitizeRecords(data);
}

/** 保存全部流水记录 */
export function saveRecords(records) {
  return writeJSON(RECORDS_KEY, Array.isArray(records) ? records : []);
}

/** 读取预算表：{ 'YYYY-MM': number } */
export function loadBudgets() {
  const data = readJSON(BUDGETS_KEY, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/** 保存预算表 */
export function saveBudgets(budgets) {
  const safe = budgets && typeof budgets === 'object' && !Array.isArray(budgets) ? budgets : {};
  return writeJSON(BUDGETS_KEY, safe);
}

/** 读取某月预算（未设置或非法时返回 0） */
export function getBudget(month) {
  const budgets = loadBudgets();
  const value = Number(budgets[month]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 设置某月预算
 * - amount 为大于 0 的有效数字时写入（保留两位小数）
 * - 否则视为清除该月预算
 */
export function setBudget(month, amount) {
  if (typeof month !== 'string' || !month) return false;
  const budgets = loadBudgets();
  const value = Number(amount);
  if (Number.isFinite(value) && value > 0) {
    budgets[month] = Math.round(value * 100) / 100;
  } else {
    delete budgets[month];
  }
  return saveBudgets(budgets);
}

/** 清空本应用所有持久化数据（谨慎使用） */
export function clearAll() {
  const store = getStore();
  if (store) {
    store.removeItem(RECORDS_KEY);
    store.removeItem(BUDGETS_KEY);
  }
  memoryStore.delete(RECORDS_KEY);
  memoryStore.delete(BUDGETS_KEY);
}
