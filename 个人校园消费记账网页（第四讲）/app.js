/**
 * app.js
 * 页面渲染与事件绑定层（浏览器环境运行）
 * - 所有业务计算委托给 src/tracker.js（纯逻辑，可在 Node.js 中单测）
 * - 所有持久化委托给 src/storage.js
 */
import {
  RECORD_TYPE,
  categoriesOf,
  createRecord,
  addRecord,
  deleteRecord,
  calcBalance,
  calcTotals,
  filterByMonth,
  filterByDate,
  sortRecords,
  statsByCategory,
  monthlyExpenseStats,
  checkBudget,
  currentMonth,
  todayStr,
  monthOf,
  formatMoney,
} from './src/tracker.js';
import { loadRecords, saveRecords, getBudget, setBudget } from './src/storage.js';

/* ---------------- 应用状态 ---------------- */
let records = loadRecords();           // 全量流水
let filterMonthValue = '';             // 月份筛选（YYYY-MM）
let filterDateValue = '';              // 日期筛选（YYYY-MM-DD）
let statsType = RECORD_TYPE.EXPENSE;   // 统计面板当前展示类型

/* 分类配色（展示层关注点，不放入纯逻辑模块） */
const CATEGORY_COLORS = {
  餐饮: '#f97316', 学习资料: '#3b82f6', 娱乐: '#a855f7', 交通: '#14b8a6',
  购物: '#ec4899', 日用: '#eab308', 其他: '#94a3b8',
  生活费: '#22c55e', 兼职: '#0ea5e9', 奖学金: '#f59e0b',
};

/* ---------------- DOM 引用 ---------------- */
const $ = (sel) => document.querySelector(sel);
const balanceValue = $('#balanceValue');
const monthExpenseValue = $('#monthExpenseValue');
const monthIncomeValue = $('#monthIncomeValue');
const budgetForm = $('#budgetForm');
const budgetMonthInput = $('#budgetMonth');
const budgetAmountInput = $('#budgetAmount');
const budgetStatus = $('#budgetStatus');
const budgetBar = $('#budgetBar');
const budgetWarning = $('#budgetWarning');
const recordForm = $('#recordForm');
const amountInput = $('#amountInput');
const categorySelect = $('#categorySelect');
const dateInput = $('#dateInput');
const noteInput = $('#noteInput');
const formError = $('#formError');
const statsRange = $('#statsRange');
const statsList = $('#statsList');
const statsEmpty = $('#statsEmpty');
const monthlyChartMonth = $('#monthlyChartMonth');
const monthlyChart = $('#monthlyChart');
const monthlyChartEmpty = $('#monthlyChartEmpty');
const filterMonthInput = $('#filterMonth');
const filterDateInput = $('#filterDate');
const clearFilterBtn = $('#clearFilterBtn');
const recordList = $('#recordList');
const emptyTip = $('#emptyTip');
const toast = $('#toast');

/* ---------------- 通用小工具 ---------------- */

let toastTimer = null;
/** 底部轻提示 */
function showToast(message, kind = 'info') {
  toast.textContent = message;
  toast.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2800);
}

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove('hidden');
}

function hideFormError() {
  formError.textContent = '';
  formError.classList.add('hidden');
}

/** 按当前类型刷新分类下拉框 */
function refreshCategoryOptions(type) {
  categorySelect.innerHTML = '';
  for (const cat of categoriesOf(type)) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  }
}

/** 当前筛选条件下的记录（已排序） */
function getFilteredRecords() {
  let list = records;
  if (filterMonthValue) list = filterByMonth(list, filterMonthValue);
  if (filterDateValue) list = filterByDate(list, filterDateValue);
  return sortRecords(list);
}

/* ---------------- 渲染 ---------------- */

/** 总览：账内余额（全部记录）+ 本月支出/收入（固定取当月，不受筛选影响） */
function renderSummary() {
  const balance = calcBalance(records);
  const monthTotals = calcTotals(filterByMonth(records, currentMonth()));
  balanceValue.textContent = `¥${formatMoney(balance)}`;
  balanceValue.classList.toggle('negative', balance < 0);
  monthExpenseValue.textContent = `¥${formatMoney(monthTotals.expense)}`;
  monthIncomeValue.textContent = `¥${formatMoney(monthTotals.income)}`;
}

/** 预算面板：展示 budgetMonth 输入框所选月份的预算执行情况 */
function renderBudget() {
  const month = budgetMonthInput.value || currentMonth();
  const status = checkBudget(records, month, getBudget(month));
  budgetWarning.classList.add('hidden');
  budgetWarning.classList.remove('warn', 'danger');

  if (!status.enabled) {
    budgetStatus.textContent = `${month} 尚未设置预算`;
    budgetBar.style.width = '0%';
    budgetBar.className = 'budget-bar';
    return;
  }

  budgetStatus.textContent =
    `${month} 预算 ¥${formatMoney(status.budget)}，已支出 ¥${formatMoney(status.spent)}` +
    `（${formatMoney(status.usage)}%），剩余 ¥${formatMoney(status.remaining)}`;
  budgetBar.style.width = `${Math.min(status.usage, 100)}%`;
  budgetBar.className = 'budget-bar';

  if (status.exceeded) {
    budgetBar.classList.add('over');
    budgetWarning.textContent = `预警：${month} 支出已超出预算 ¥${formatMoney(status.overAmount)}，请注意控制开销！`;
    budgetWarning.classList.remove('hidden');
    budgetWarning.classList.add('danger');
  } else if (status.usage >= 80) {
    budgetBar.classList.add('near');
    budgetWarning.textContent = `提醒：${month} 预算已使用 ${formatMoney(status.usage)}%，快到上限啦～`;
    budgetWarning.classList.remove('hidden');
    budgetWarning.classList.add('warn');
  }
}

/** 本月支出柱状图：固定统计当前自然月，不受流水筛选条件影响 */
function renderMonthlyChart() {
  const month = currentMonth();
  monthlyChartMonth.textContent = `${month} 月`;

  // 数据计算委托给纯逻辑层：filterByMonth + statsByCategory(expense) 的组合
  const stats = monthlyExpenseStats(records, month);
  monthlyChart.innerHTML = '';
  const hasData = stats.length > 0;
  // 空态切换：当月无支出时隐藏图表、显示提示文案
  monthlyChartEmpty.classList.toggle('hidden', hasData);
  monthlyChart.classList.toggle('hidden', !hasData);
  if (!hasData) return;

  // 以当月最大分类金额为满刻度，其余柱高按占比缩放
  const maxAmount = Math.max(...stats.map((s) => s.amount));
  for (const item of stats) {
    const col = document.createElement('div');
    col.className = 'chart-col';

    // 柱子上方：金额标签
    const valEl = document.createElement('span');
    valEl.className = 'chart-val';
    valEl.textContent = `¥${formatMoney(item.amount)}`;

    // 柱子本体：高度按占最大值比例缩放，保底 3% 确保小金额可见
    const barWrap = document.createElement('div');
    barWrap.className = 'chart-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    const ratio = maxAmount > 0 ? (item.amount / maxAmount) * 100 : 0;
    bar.style.height = `${Math.max(ratio, 3)}%`;
    bar.style.backgroundColor = CATEGORY_COLORS[item.category] || '#94a3b8';
    barWrap.appendChild(bar);

    // 柱子下方：分类名
    const catEl = document.createElement('span');
    catEl.className = 'chart-cat';
    catEl.textContent = item.category;

    col.append(valEl, barWrap, catEl);
    monthlyChart.appendChild(col);
  }
}

/** 分类统计：基于当前筛选结果，纯 CSS 条形图 */
function renderStats() {
  // 统计范围提示
  statsRange.textContent = filterDateValue
    ? `${filterDateValue} 当日`
    : filterMonthValue
      ? `${filterMonthValue} 月`
      : '全部时间';

  const stats = statsByCategory(getFilteredRecords(), statsType);
  statsList.innerHTML = '';
  statsEmpty.classList.toggle('hidden', stats.length > 0);

  for (const item of stats) {
    const row = document.createElement('div');
    row.className = 'stats-row';

    const info = document.createElement('div');
    info.className = 'stats-info';
    const catEl = document.createElement('span');
    catEl.className = 'stats-cat';
    catEl.textContent = item.category;
    const valEl = document.createElement('span');
    valEl.className = 'stats-val';
    valEl.textContent = `¥${formatMoney(item.amount)} · ${formatMoney(item.percent)}%`;
    info.append(catEl, valEl);

    const barWrap = document.createElement('div');
    barWrap.className = 'stats-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'stats-bar';
    bar.style.width = `${Math.min(item.percent, 100)}%`;
    bar.style.backgroundColor = CATEGORY_COLORS[item.category] || '#94a3b8';
    barWrap.appendChild(bar);

    row.append(info, barWrap);
    statsList.appendChild(row);
  }
}

/** 构造单条流水 DOM（全程 textContent，避免备注注入 XSS） */
function buildRecordItem(record) {
  const li = document.createElement('li');
  li.className = `record-item ${record.type}`;

  const badge = document.createElement('span');
  badge.className = 'record-badge';
  badge.style.backgroundColor = CATEGORY_COLORS[record.category] || '#94a3b8';
  badge.textContent = record.category;

  const main = document.createElement('div');
  main.className = 'record-main';
  const noteEl = document.createElement('span');
  noteEl.className = 'record-note';
  noteEl.textContent = record.note || record.category;
  const dateEl = document.createElement('span');
  dateEl.className = 'record-date';
  dateEl.textContent = record.date;
  main.append(noteEl, dateEl);

  const right = document.createElement('div');
  right.className = 'record-right';
  const amountEl = document.createElement('span');
  amountEl.className = `record-amount ${record.type}`;
  const sign = record.type === RECORD_TYPE.INCOME ? '+' : '-';
  amountEl.textContent = `${sign}¥${formatMoney(record.amount)}`;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'record-delete';
  delBtn.dataset.id = record.id;
  delBtn.title = '删除该记录';
  delBtn.textContent = '删除';
  right.append(amountEl, delBtn);

  li.append(badge, main, right);
  return li;
}

/** 流水列表渲染 */
function renderRecords() {
  const list = getFilteredRecords();
  recordList.innerHTML = '';
  emptyTip.classList.toggle('hidden', list.length > 0);
  for (const r of list) {
    recordList.appendChild(buildRecordItem(r));
  }
}

function renderAll() {
  renderSummary();
  renderBudget();
  renderMonthlyChart();
  renderStats();
  renderRecords();
}

/* ---------------- 事件绑定 ---------------- */

/** 记账表单提交：校验 -> 建记录 -> 持久化 -> 重渲染，并在超支时即时预警 */
function onRecordSubmit(event) {
  event.preventDefault();
  hideFormError();
  const formData = new FormData(recordForm);
  const type = formData.get('type');

  try {
    const record = createRecord({
      type,
      amount: amountInput.value,
      category: categorySelect.value,
      date: dateInput.value,
      note: noteInput.value,
    });
    records = addRecord(records, record);
    saveRecords(records);

    // 重置表单并恢复默认值
    recordForm.reset();
    refreshCategoryOptions(RECORD_TYPE.EXPENSE);
    dateInput.value = todayStr();
    amountInput.focus();

    renderAll();

    // 支出记录：实时检查该月预算，超支立即提醒
    if (record.type === RECORD_TYPE.EXPENSE) {
      const status = checkBudget(records, monthOf(record.date), getBudget(monthOf(record.date)));
      if (status.enabled && status.exceeded) {
        showToast(`预警：${status.month} 已超支 ¥${formatMoney(status.overAmount)}！`, 'warn');
        return;
      }
    }
    showToast('记录添加成功');
  } catch (err) {
    showFormError(err.message || '添加失败，请检查输入');
  }
}

/** 预算设置 */
function onBudgetSubmit(event) {
  event.preventDefault();
  const month = budgetMonthInput.value;
  const amount = Number(budgetAmountInput.value);
  if (!month) {
    showToast('请先选择预算月份', 'error');
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('请输入大于 0 的预算金额', 'error');
    return;
  }
  setBudget(month, amount);
  budgetAmountInput.value = '';
  renderBudget();
  showToast(`${month} 预算已设置为 ¥${formatMoney(amount)}`);
}

function bindEvents() {
  recordForm.addEventListener('submit', onRecordSubmit);
  budgetForm.addEventListener('submit', onBudgetSubmit);
  budgetMonthInput.addEventListener('change', renderBudget);

  // 支出/收入切换时联动分类下拉
  recordForm.querySelectorAll('input[name="type"]').forEach((radio) => {
    radio.addEventListener('change', (e) => refreshCategoryOptions(e.target.value));
  });

  // 删除记录（事件委托，兼容动态列表）
  recordList.addEventListener('click', (e) => {
    const btn = e.target.closest('.record-delete');
    if (!btn) return;
    if (!window.confirm('确定删除这条记录吗？')) return;
    records = deleteRecord(records, btn.dataset.id);
    saveRecords(records);
    renderAll();
    showToast('记录已删除');
  });

  // 月份筛选：变更时清除具体日期筛选，避免条件冲突
  filterMonthInput.addEventListener('change', () => {
    filterMonthValue = filterMonthInput.value;
    filterDateValue = '';
    filterDateInput.value = '';
    renderRecords();
    renderStats();
  });

  // 日期筛选：自动把月份筛选对齐到该日所在月
  filterDateInput.addEventListener('change', () => {
    filterDateValue = filterDateInput.value;
    if (filterDateValue) {
      filterMonthValue = monthOf(filterDateValue);
      filterMonthInput.value = filterMonthValue;
    }
    renderRecords();
    renderStats();
  });

  clearFilterBtn.addEventListener('click', () => {
    filterMonthValue = '';
    filterDateValue = '';
    filterMonthInput.value = '';
    filterDateInput.value = '';
    renderRecords();
    renderStats();
  });

  // 统计面板 支出/收入 切换
  document.querySelectorAll('.chip[data-stats-type]').forEach((chip) => {
    chip.addEventListener('click', () => {
      statsType = chip.dataset.statsType;
      document.querySelectorAll('.chip[data-stats-type]')
        .forEach((c) => c.classList.toggle('active', c === chip));
      renderStats();
    });
  });
}

/* ---------------- 初始化 ---------------- */

function init() {
  dateInput.value = todayStr();
  budgetMonthInput.value = currentMonth();
  refreshCategoryOptions(RECORD_TYPE.EXPENSE);
  bindEvents();
  renderAll();
}

init();
