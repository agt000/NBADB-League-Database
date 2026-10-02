// 面板冒烟测试：最小DOM垫片驱动 openManager(tab)×9 —— 覆盖 renderTable TDZ bug 路径
const handlers = new Map();
const eventSource = {
  on(t, h) { if (!handlers.has(t)) handlers.set(t, []); handlers.get(t).push(h); },
  off() { },
  emit(t, ...args) { for (const h of [...(handlers.get(t) || [])]) h(...args); },
};
const ET = { APP_READY: 'r', MESSAGE_SENT: 'a', MESSAGE_RECEIVED: 'b', MESSAGE_EDITED: 'c', MESSAGE_SWIPED: 'd', MESSAGE_DELETED: 'e', CHAT_CHANGED: 'f', GENERATION_STARTED: 'g', GENERATION_ENDED: 'h', GENERATION_STOPPED: 'i', CHARACTER_MESSAGE_RENDERED: 'j' };
const chat = [];
const theCtx = { chat, chatId: 'paneltest', chatMetadata: {}, characters: [{ avatar: 'c.png', chat: 'cf1' }], characterId: 0, eventSource, event_types: ET, extensionSettings: {}, saveMetadata: async () => { }, saveChat: async () => { }, addOneMessage: () => { }, executeSlashCommands: async () => '' };
globalThis.SillyTavern = { getContext: () => theCtx, libs: {} };
globalThis.toastr = { success() { }, error() { }, warning() { }, info() { } };
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; } };

const mkEl = () => {
  const el = {
    _html: '', _q: new Map(),
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    set textContent(v) { this._html = String(v); },
    get textContent() { return this._html; },
    value: '',
    setAttribute() { }, appendChild() { }, remove() { }, click() { }, focus() { },
    querySelectorAll() { return []; },
    querySelector(sel) { if (!this._q.has(sel)) this._q.set(sel, mkEl()); return this._q.get(sel); },
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    dataset: {}, style: {}, onclick: null, oninput: null, onchange: null,
  };
  return el;
};
const elCache = new Map();
globalThis.document = {
  querySelector(sel) { if (!elCache.has(sel)) elCache.set(sel, mkEl()); return elCache.get(sel); },
  querySelectorAll() { return []; },
  createElement() { return mkEl(); },
  body: Object.assign(mkEl(), {}),
};

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

const { readFileSync } = await import('node:fs');
const mod = await import('../index.js');
await mod.onActivate();
eventSource.emit(ET.APP_READY);
await new Promise(r => setTimeout(r, 100));
ok(!!globalThis.NBADB, 'init');

await NBADB.issue().then(() => NBADB.connect(null));
await NBADB.importJson(readFileSync(new URL('../data/league_2001.json', import.meta.url), 'utf8'), 'league_2001.json');
await NBADB.importJson(readFileSync(new URL('../data/prospects_pool.json', import.meta.url), 'utf8'), 'prospects_pool.json');
await NBADB.createManager({ name: '测', team: '洛杉矶湖人', background: '前球员' });
await NBADB.start();

chat.push({ is_user: true, mes: '开局', send_date: 1, extra: {} });
await globalThis.nbadbInterceptor([...chat], 0, () => { }, 'normal');
ok((await NBADB.db()).dice?.turn === 1, '预掷骰子');
const cases = [
  ['manager', '前球员'],
  ['roster', '沙奎尔·奥尼尔'],
  ['league', '萨克拉门托国王'],
  ['players', '文斯·卡特'],
  ['assets', '首轮签(自有)'],
  ['programs', '进度%'],
  ['events', '轮'],
  ['prospects', '勒布朗·詹姆斯'],
  ['dice', 'd20'],
];
for (const [tab, marker] of cases) {
  let err = null;
  try { await NBADB.open(tab); } catch (e) { err = e; }
  const html = elCache.get('#nbadb-body').innerHTML;
  ok(err === null, `tab ${tab} 不抛错${err ? '：' + err.message : ''}`);
  ok(html.includes(marker), `tab ${tab} 内容含「${marker}」(${html.length}字符)`);
  if (['roster', 'league', 'players', 'assets', 'programs', 'events', 'prospects'].includes(tab)) {
    ok(html.includes('nbadb-th-sort') && html.includes('nbadb-filter-open'), `tab ${tab} 含排序表头+筛选按钮`);
    ok(html.includes('显示 ') && html.includes('筛选'), '含显示行数与筛选按钮');
  }
}
console.log(`\n==== 面板冒烟：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
