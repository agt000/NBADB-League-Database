// NBADB core.js —— 纯逻辑核心（无SillyTavern/DOM依赖，可单测）
// 数据模型 / 结算协议 / 联盟结算 / 注入构造 / 价值算法
'use strict';

export const COLLECTIONS = ['manager', 'team', 'players', 'assets', 'programs', 'events', 'league', 'prospects', 'freeAgents', 'rules'];
export const PATCH_KEYS = ['manager', 'team', 'players', 'assets', 'programs', 'events', 'freeAgents'];
export const FORBIDDEN_PATCH_KEYS = ['league', 'dice', 'connection', 'meta', 'prospects', 'rules'];

export const POS_WEIGHTS6 = {
  PG: [.10, .15, .80, .45, .35, .15],
  SG: [.18, .22, .70, .42, .28, .20],
  SF: [.35, .28, .52, .38, .22, .25],
  PF: [.55, .48, .33, .22, .16, .26],
  C:  [.68, .60, .12, .22, .13, .25],
};
export const POS_WEIGHTS = { PG: [.15, .20, 1.05, .60], SG: [.25, .30, .90, .55], SF: [.45, .35, .70, .50], PF: [.70, .60, .45, .25], C: [.85, .75, .15, .25] };
export function calcOvr(pos, io, id_, oo, od, pm, mt) {
  const w = POS_WEIGHTS6[pos] || POS_WEIGHTS6.SF;
  return Math.round(io*w[0] + id_*w[1] + oo*w[2] + od*w[3] + (pm??28)*w[4] + (mt??30)*w[5]);
}

export const TEAM_NAMES = ['费城76人','密尔沃基雄鹿','迈阿密热火','纽约尼克斯','多伦多猛龙','夏洛特黄蜂','奥兰多魔术','印第安纳步行者','底特律活塞','波士顿凯尔特人','克利夫兰骑士','新泽西篮网','亚特兰大老鹰','华盛顿奇才','芝加哥公牛','圣安东尼奥马刺','洛杉矶湖人','萨克拉门托国王','犹他爵士','达拉斯小牛','菲尼克斯太阳','波特兰开拓者','明尼苏达森林狼','休斯顿火箭','西雅图超音速','丹佛掘金','洛杉矶快船','孟菲斯灰熊','金州勇士'];
export const BACKGROUNDS = {
  '前球员': { trust: 5, fame: 5, note: '更衣室人脉+球员信任' },
  '数据分析师': { trust: 0, fame: 0, note: '交易估值+1修正' },
  '经纪人': { trust: 0, fame: 5, note: '经纪人网络：招募检定+1' },
  '球探': { trust: 0, fame: 0, note: '情报检定+1' },
  '富二代': { trust: 10, fame: 0, note: '老板圈层：初始信任+10' },
  '联盟新星经理': { trust: 5, fame: 10, note: '声望起点更高' },
};

export function emptyDb() {
  return {
    meta: { schema: 1, created: Date.now(), revision: 0, season: 0, date: '2001-06-01', phase: '休赛期·选秀前夜', importedFiles: {}, gameStarted: false },
    connection: null,
    manager: { created: false, confirmed: false, name: '', team: '', background: '', style: '', trust: 50, fame: 50 },
    team: [],
    players: [],
    league: [],
    assets: [],
    programs: [],
    events: [],
    prospects: [],
    freeAgents: [],
    rules: [],
    dice: null,
    settlementReceipts: [],
  };
}

export function validateDb(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('数据库结构错误：不是对象');
  if (!d.meta || typeof d.meta !== 'object') throw new Error('数据库结构错误：meta');
  if (!d.manager || typeof d.manager !== 'object') throw new Error('数据库结构错误：manager');
  for (const col of ['team', 'players', 'assets', 'programs', 'events', 'league', 'prospects', 'freeAgents', 'rules']) {
    if (!Array.isArray(d[col])) throw new Error('数据库结构错误：' + col);
  }
  if (d.players.some(p => !p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name)) throw new Error('players存在无name行');
  return d;
}

/* ============ 宏防护与容错解析 ============ */
export function escapeMacros(t) { return String(t).replace(/\{\{/g, '\uFF5B\uFF5B'); }
export function unescapeMacros(t) { return String(t).replace(/\uFF5B\uFF5B/g, '{{'); }
export function stripFence(t) {
  return String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}
export function robustJsonParse(text) {
  const tryParse = (s) => { try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false, err: e }; } };
  let t = stripFence(String(text));
  let r = tryParse(t);
  if (r.ok) return r.value;
  // 括号深度截取最外层 {..} 或 [..]
  const open = t.search(/[{[]/);
  if (open >= 0) {
    const o = t[open], c = o === '{' ? '}' : ']';
    let depth = 0, end = -1, inStr = false, esc2 = false;
    for (let i = open; i < t.length; i++) {
      const ch = t[i];
      if (esc2) { esc2 = false; continue; }
      if (ch === '\\') { esc2 = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === o) depth++;
      else if (ch === c) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > open) { r = tryParse(t.slice(open, end + 1)); if (r.ok) return r.value; }
  }
  // 修复：单引号值 / 尾逗号 / 无引号键
  let fixed = t.replace(/([{,]\s*)([A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*)\s*:/g, '$1"$2":')
    .replace(/'((?:[^'\\]|\\.)*)'/g, '"$1"')
    .replace(/,(\s*[}\]])/g, '$1');
  r = tryParse(fixed);
  if (r.ok) return r.value;
  if (end > open) { r = tryParse(fixed.slice(open, end + 1).replace(/,(\s*[}\]])/g, '$1')); if (r.ok) return r.value; }
  throw new Error('JSON解析失败：' + (r.err ? r.err.message : '无法修复'));
}

/* ============ 标签解析 ============ */
export const RE_SETTLEMENT = /(?:^|\n)[ \t]*(?:(```(?:json)?)[ \t]*\r?\n)?[ \t]*<\s*nbadb-settlement\s*>\s*([\s\S]*?)\s*<\s*\/nbadb-settlement\s*>[ \t]*(?:\r?\n[ \t]*(```))?\s*$/i;
export const RE_LEAGUE = /<\s*nbadb-league\s*>\s*([\s\S]*?)\s*<\s*\/nbadb-league\s*>/gi;

export function parseSettlement(text) {
  const probe = /<\s*nbadb-settlement/i.test(text);
  if (!probe) return null;
  const matches = [...String(text).matchAll(new RegExp(RE_SETTLEMENT.source, 'gi'))];
  if (!matches.length) throw new Error('存在nbadb-settlement标签但格式不合法（须位于消息最末尾、独立成行且闭合）');
  const m = matches[matches.length - 1];
  const payload = robustJsonParse(unescapeMacros(m[2]));
  const clean = String(text).slice(0, m.index).replace(/[ \t\r\n]+$/, '');
  return { payload, clean, fenced: !!(m[1] || m[3]) };
}

export function parseLeagueTag(text) {
  const tags = [...String(text).matchAll(RE_LEAGUE)];
  if (!tags.length) return null;
  if (tags.length > 1) throw new Error('nbadb-league标签只能出现一次');
  const payload = robustJsonParse(unescapeMacros(tags[0][1]));
  if (!Array.isArray(payload)) throw new Error('nbadb-league内容必须是数组');
  return { payload, raw: tags[0][0] };
}

/* ============ 结算校验与应用 ============ */
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v) => Number.isSafeInteger(v);
const str = (v) => typeof v === 'string';

export function normalizePlayerRow(row, existing) {
  const out = existing ? { ...existing, ...{} } : null;
  const r = { ...(out || {}) };
  if (!str(row.name) || !row.name.trim()) throw new Error('players行缺少name');
  r.name = row.name.trim();
  const pos = str(row.pos) ? row.pos.trim().toUpperCase().replace(/\/.*$/, '') : (r.pos || '');
  if (pos) { if (!POS_WEIGHTS[pos]) throw new Error('非法位置：' + row.pos); r.pos = pos; }
  else if (!r.pos) throw new Error('players行缺少pos');
  if (row.team !== undefined) { if (row.team === '') r.team = ''; else { if (!str(row.team) || !TEAM_NAMES.includes(row.team.trim())) throw new Error('非法球队：' + row.team); r.team = row.team.trim(); } }
  else if (!r.team) throw new Error('players行缺少team');
  if (row.age !== undefined) { if (!int(row.age) || row.age < 15 || row.age > 60) throw new Error('非法年龄：' + row.age); r.age = row.age; }
  else if (!int(r.age)) throw new Error('players行缺少age');
  for (const [k, cap] of [['inside_off', 50], ['inside_def', 50], ['outside_off', 50], ['outside_def', 50], ['playmaking', 50], ['mental', 50]]) {
    if (row[k] !== undefined) { if (!num(row[k]) || row[k] < 0 || row[k] > cap) throw new Error(`非法${k}：${row[k]}（0-${cap}）`); r[k] = row[k]; }
  }
  if (row.ovr !== undefined) { if (!int(row.ovr) || row.ovr < 0 || row.ovr > 100) throw new Error('非法ovr：' + row.ovr); r.ovr = row.ovr; }
  else if (!int(r.ovr)) r.ovr = calcOvr(r.pos, r.inside_off || 0, r.inside_def || 0, r.outside_off || 0, r.outside_def || 0, r.playmaking || 25, r.mental || 28);
  else if (!int(r.ovr)) r.ovr = calcOvr(r.pos, r.inside_off || 0, r.inside_def || 0, r.outside_off || 0, r.outside_def || 0);
  if (row.pot !== undefined) { if (!int(row.pot) || row.pot < 0 || row.pot > 100) throw new Error('非法pot：' + row.pot); r.pot = row.pot; }
  else if (!int(r.pot)) throw new Error('players行缺少pot');
  if (row.salary !== undefined) { if (!num(row.salary) || row.salary < 0) throw new Error('非法salary：' + row.salary); r.salary = row.salary; }
  for (const k of ['contract', 'injury', 'status', 'note']) if (row[k] !== undefined) r[k] = str(row[k]) ? row[k] : String(row[k]);
  for (const k of ['untouchable', 'core_asset']) {
    if (row[k] !== undefined) r[k] = row[k] === true || row[k] === 1 || row[k] === '1' || row[k] === '是' ? 1 : 0;
    else if (r[k] === undefined) r[k] = k === 'untouchable' ? (r.ovr >= 88 ? 1 : 0) : (r.ovr >= 80 ? 1 : 0);
  }
  if (r.untouchable && r.core_asset) r.core_asset = 0; // 非卖品优先
  if (row.trade_value !== undefined) { if (!num(row.trade_value)) throw new Error('非法trade_value'); r.trade_value = row.trade_value; }
  else if (!num(r.trade_value)) r.trade_value = tradeValueOf(r);
  if (row.contract_years !== undefined) { if (!int(row.contract_years) || row.contract_years < 0 || row.contract_years > 8) throw new Error('非法contract_years：' + row.contract_years); r.contract_years = row.contract_years; }
  else if (!int(r.contract_years)) r.contract_years = r.salary <= 0.9 ? 1 : (r.age <= 23 ? 3 : r.age <= 32 ? 3 : 2);
  if (row.durability !== undefined) { if (!int(row.durability) || row.durability < 0 || row.durability > 100) throw new Error('非法durability'); r.durability = row.durability; }
  else if (!int(r.durability)) r.durability = 55;
  if (row.injury_prone !== undefined) { if (!int(row.injury_prone) || row.injury_prone < 0 || row.injury_prone > 100) throw new Error('非法injury_prone：' + row.injury_prone); r.injury_prone = row.injury_prone; }
  else if (!int(r.injury_prone)) r.injury_prone = calcInjuryProne(r);
  if (row.option !== undefined) { if (!['', '球员选项', '球队选项'].includes(row.option)) throw new Error('非法option：' + row.option); r.option = row.option; }
  else if (r.option === undefined) r.option = '';
  if (row.contract_total !== undefined) { if (!num(row.contract_total) || row.contract_total < 0) throw new Error('非法contract_total'); r.contract_total = row.contract_total; }
  else if (!num(r.contract_total)) r.contract_total = Math.round((r.salary || 0) * (r.contract_years || 1) * 10) / 10;
  return r;
}
export function normalizeNeeds(needs) {
  if (!needs) return [];
  if (str(needs)) return [{ type: '模糊', text: needs }];
  if (!Array.isArray(needs)) return [];
  return needs.map(n => n && typeof n === 'object' && n.text ? { type: n.type === '指定' ? '指定' : '模糊', text: String(n.text) } : { type: '模糊', text: String(n) }).filter(n => n.text);
}

export function normalizeRow(col, row, existing) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(col + '行必须是对象');
  if (row.delete === true) {
    const key = col === 'players' || col === 'assets' || col === 'programs' ? row.name : col === 'team' || col === 'manager' ? row.field : null;
    if (!key) throw new Error(col + '删除行缺少唯一键');
    return { __delete: true, __key: String(key).trim() };
  }
  switch (col) {
    case 'manager':
    case 'team': {
      if (!str(row.field) || !row.field.trim()) throw new Error(col + '行缺少field');
      const value = row.value === undefined ? '' : row.value;
      return { field: row.field.trim(), value: num(value) ? value : String(value), note: row.note === undefined ? '' : String(row.note) };
    }
    case 'players': return normalizePlayerRow(row, existing);
    case 'assets': {
      if (!str(row.name) || !row.name.trim()) throw new Error('assets行缺少name');
      return { name: row.name.trim(), type: str(row.type) ? row.type : '其他', detail: row.detail === undefined ? '' : String(row.detail), value: row.value === undefined ? '' : (num(row.value) ? row.value : String(row.value)), note: row.note === undefined ? '' : String(row.note) };
    }
    case 'programs': {
      if (!str(row.name) || !row.name.trim()) throw new Error('programs行缺少name');
      const kind = str(row.kind) ? row.kind : (existing && existing.kind) || '';
      if (!['伤病恢复', '潜力兑现', '抗衰退'].includes(kind)) throw new Error('非法训练类型：' + kind);
      let progress = row.progress !== undefined ? row.progress : (existing && existing.progress) !== undefined ? existing.progress : 0;
      if (str(progress) && /^[\d.]+%$/.test(progress.trim())) progress = Number(progress.trim().replace('%', ''));
      if (!num(progress) || progress < 0 || progress > 100) throw new Error('非法进度：' + row.progress);
      return { name: row.name.trim(), player: str(row.player) ? row.player : (existing && existing.player) || '', kind, progress, note: row.note === undefined ? '' : String(row.note) };
    }
    case 'freeAgents': {
      const fa = normalizePlayerRow({ ...row, team: row.team ?? '', status: row.status ?? '自由球员', contract_years: row.contract_years ?? 0, salary: row.salary ?? 0 }, existing);
      if (fa.status === '现役') fa.status = '自由球员';
      return fa;
    }
    case 'events': {
      if ((!str(row.title) || !row.title.trim()) && !str(row.eventId)) throw new Error('events行缺少title');
      return { eventId: row.eventId ? String(row.eventId) : undefined, turn: int(row.turn) ? row.turn : undefined, title: str(row.title) ? row.title.trim() : '', detail: str(row.detail) ? row.detail : '', kind: str(row.kind) ? row.kind : 'event' };
    }
    default: throw new Error('非法集合：' + col);
  }
}

function stableEventId(ev) {
  const key = JSON.stringify([ev.turn ?? null, ev.title, ev.detail]);
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return 'ev-' + h.toString(36);
}

export function validateSettlement(payload, baseline, turnNow, baseRevision) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('结算payload必须是对象');
  const allowed = ['turn', 'baseRevision', 'patch'];
  for (const k of Object.keys(payload)) if (!allowed.includes(k)) throw new Error('结算包含非法字段：' + k);
  if (!int(payload.turn) || payload.turn !== turnNow) throw new Error(`turn非法或过期（须为${turnNow}）`);
  if (!int(payload.baseRevision)) throw new Error('baseRevision非法');
  if (payload.baseRevision !== baseRevision) throw new Error(`baseRevision冲突（基线${baseRevision}，标签${payload.baseRevision}）——请以当前注入快照为准重试`);
  if (payload.patch === undefined) throw new Error('缺少patch');
  if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) throw new Error('patch必须是对象');
  const next = structuredClone(baseline);
  const changes = {};
  for (const [col, rows] of Object.entries(payload.patch)) {
    if (!PATCH_KEYS.includes(col)) throw new Error(`patch包含非法集合：${col}（league须走nbadb-league标签）`);
    if (!Array.isArray(rows)) throw new Error(col + '必须是数组');
    const applied = [];
    for (const row of rows) {
      let existing;
      if (col === 'players') existing = next.players.find(p => p.name === String(row.name || '').trim());
      else if (col === 'assets') existing = next.assets.find(p => p.name === String(row.name || '').trim());
      else if (col === 'programs') existing = next.programs.find(p => p.name === String(row.name || '').trim());
      const norm = normalizeRow(col, row, existing);
      applyRow(next, col, norm);
      applied.push(norm);
    }
    changes[col] = applied;
  }
  validateDb(next);
  return { next, changes };
}

function applyRow(db, col, norm) {
  if (norm.__delete) {
    if (col === 'events') throw new Error('events不可删除');
    const arr = db[col];
    const idx = arr.findIndex(r => (col === 'players' || col === 'assets' || col === 'programs') ? r.name === norm.__key : r.field === norm.__key);
    if (idx < 0) throw new Error(col + '删除目标不存在：' + norm.__key);
    arr.splice(idx, 1);
    return;
  }
  switch (col) {
    case 'manager':
    case 'team': {
      const arr = db[col === 'manager' ? 'team' : 'team'];
      const target = col === 'manager' ? db.manager : arr;
      if (col === 'manager') {
        if (['created', 'confirmed'].includes(norm.field)) throw new Error('禁止修改manager.' + norm.field);
        db.manager[norm.field] = norm.value;
      } else {
        const ex = arr.find(r => r.field === norm.field);
        if (ex) { ex.value = norm.value; ex.note = norm.note; } else arr.push(norm);
      }
      break;
    }
    case 'players': {
      const ex = db.players.find(p => p.name === norm.name);
      if (ex) Object.assign(ex, norm);
      else {
        if (db.players.some(p => p.name === norm.name)) throw new Error('不可能：重名');
        db.players.push(norm);
      }
      break;
    }
    case 'assets': case 'programs': case 'freeAgents': {
      const ex = db[col].find(r => r.name === norm.name);
      if (ex) Object.assign(ex, norm);
      else db[col].push(norm);
      break;
    }
    case 'events': {
      const ev = { ...norm };
      ev.eventId = ev.eventId || stableEventId(ev);
      ev.turn = ev.turn ?? 0;
      const ex = db.events.find(e => e.eventId === ev.eventId);
      if (ex) Object.assign(ex, ev);
      else if (db.events.some(e => e.turn === ev.turn && e.title === ev.title && e.detail === ev.detail)) { /* 三元组去重：跳过 */ }
      else db.events.push(ev);
      break;
    }
  }
}

/* ============ 联盟结算（赛季末29队变化清单） ============ */
export function applyLeagueUpdate(db, payload) {
  const next = structuredClone(db);
  if (payload.length !== 29) throw new Error(`联盟清单须为29队，收到${payload.length}队`);
  const seen = new Set();
  for (const t of payload) {
    if (!t || typeof t !== 'object' || !str(t.team) || !TEAM_NAMES.includes(t.team)) throw new Error('联盟清单包含非法球队：' + (t && t.team));
    if (seen.has(t.team)) throw new Error('联盟清单球队重复：' + t.team);
    seen.add(t.team);
  }
  const moves = [];
  const coreRows = [];
  for (const t of payload) {
    const row = next.league.find(r => r.team === t.team);
    if (!row) throw new Error('数据库缺少球队行：' + t.team + '（请先导入联盟快照）');
    for (const k of ['record', 'rank', 'playoffs', 'note', 'picks']) if (t[k] !== undefined) row[k] = str(t[k]) ? t[k] : String(t[k]);
    if (t.needs !== undefined) row.needs = normalizeNeeds(t.needs);
    if (t.payroll !== undefined && num(t.payroll)) row.payroll = t.payroll;
    if (Array.isArray(t.out)) for (const name of t.out) moves.push({ name: String(name), to: null });
    if (Array.isArray(t.core)) coreRows.push([row, t.core]);
    if (Array.isArray(t.in)) for (const name of t.in) moves.push({ name: String(name), to: t.team });
  }
  // in/out 移动：先处理 out 记录（to=null），再按 in 归队
  const outs = new Map();
  for (const m of moves) if (m.to === null) outs.set(m.name, true);
  for (const m of moves) {
    if (m.to === null) continue;
    let p = next.players.find(p => p.name === m.name);
    if (!p) {
      p = { name: m.name, team: m.to, pos: 'SF', age: 22, inside_off: 20, inside_def: 20, outside_off: 20, outside_def: 20, ovr: 50, pot: 50, salary: 1, contract: '未知', injury: '', status: '由nbadb-league入档（待补全）', note: '' };
      next.players.push(p);
    } else p.team = m.to;
  }
  for (const [name] of outs) {
    if (!moves.some(m => m.name === name && m.to)) {
      const p = next.players.find(p => p.name === name);
      if (p && p.status === '现役') p.status = '离队/退役（待AI在叙事中补全）';
    }
  }
  for (const [row, core] of coreRows) {
    for (const c of core) {
      if (!c || !str(c.name)) continue;
      const pl = next.players.find(p => p.name === c.name);
      if (pl) {
        if (c.ovr !== undefined && int(c.ovr)) pl.ovr = c.ovr;
        if (c.pot !== undefined && int(c.pot)) pl.pot = c.pot;
        if (c.age !== undefined && int(c.age)) pl.age = c.age;
      }
    }
    row.core = core.filter(c => c && str(c.name)).map(c => `${c.name} ${c.ovr ?? '?'}${c.pot !== undefined ? '/' + c.pot : ''}`).join('、');
  }
  ensureDraftAssets(next);
  validateDb(next);
  return next;
}

/* ============ 骰子 ============ */
export function rollDice() {
  const r = (n) => 1 + Math.floor(Math.random() * n);
  return { d20a: r(20), d20b: r(20), inj1: r(20), inj2: r(20) };
}

/* ============ 注入构造 ============ */
export const INJECTION_CHAR_LIMIT = 60000;

export const RULE_TEXT = [
  '【NBADB 联盟数据库·协议提醒】',
  '1.数据库是最高状态权威：库＞角色卡＞世界书＞叙事记忆。状态面板/计数器/进行中项目的数值一律取自本快照，快照缺失项标「未记录」，禁止编造库内没有的球员数值。',
  '2.判定必须引用下方dice现值（d20甲/乙=检定与谈判；inj1/2=伤病掷骰），不得自行模拟骰子；同轮重试沿用现值。',
  '3.正式回复六要素之后，必须以「本轮结算快照（待结算）」和唯一末尾标签结束：',
  '<nbadb-settlement>{"turn":<本轮用户轮次>,"baseRevision":<快照revision>,"patch":{}}</nbadb-settlement>',
  'patch仅写本轮变化行（数值绝对值；无变化写{}）：manager[]/team[]（field/value/note）；players[]（唯一键name，可改ovr/四维/pot/salary/injury/status等，新球员须含name/team/pos/age/四维/pot）；assets[]（唯一键name：选秀权/特例/现金）；programs[]（唯一键name：训练项目player/kind/progress）；events[]（eventId/turn/title/detail追加）。',
  '4.禁止写league/dice/connection（league只在赛季末用nbadb-league标签）；禁止宣称「已保存」；保存由插件完成后移除标签。',
  '5.赛季结束（总决赛后）在本轮settlement之后追加：<nbadb-league>[{team,record,rank,playoffs,in,out,core,payroll,picks,note}×29队]</nbadb-league>。',
].join('\n');

export function buildInjection(db, opts = {}) {
  const myTeam = db.manager.team;
  const myRoster = db.players.filter(p => p.team === myTeam).sort((a, b) => b.ovr - a.ovr);
  const brief = p => `${p.name}|${p.pos}|${p.age}岁|${p.inside_off}/${p.inside_def}/${p.outside_off}/${p.outside_def}|OVR${p.ovr}/潜力${p.pot}|${p.trade_value ?? tradeValueOf(p)}交易值|耐久${p.durability ?? 55}/倾向${p.injury_prone ?? calcInjuryProne(p)}${p.untouchable ? '|非卖品' : p.core_asset ? '|重要资产' : ''}|${p.salary}M×剩${p.contract_years ?? '?'}年${p.option ? '(' + p.option + ')' : ''}${p.injury ? '|伤:' + p.injury : ''}${p.status && p.status !== '现役' ? '|' + p.status : ''}${p.note ? '|注:' + p.note : ''}`;
  const snap = {};
  snap.manager = { ...db.manager, created: undefined, confirmed: undefined };
  snap.team = db.team;
  snap.roster = myRoster.map(brief);
  snap.assets = db.assets.map(a => `${a.name}|${a.type}|${a.detail || a.value || ''}${a.note ? '|注:' + a.note : ''}`);
  snap.programs = db.programs.map(p => `${p.name}|${p.kind}|${p.player}|进度${p.progress}%${p.note ? '|注:' + p.note : ''}`);
  updateLeagueStandings(db);
  snap.league = db.league.map(l => {
    const fut = assessFutureStrength(l.team, db);
    return `${l.team}(${l.conference})|${l.record}|${l.rank}|选秀:${l.expectedDraftPos || '?'}|未来:${fut.score}/5${fut.reasons.length ? '(' + fut.reasons.slice(0, 2).join(';') + ')' : ''}|核心:${l.core || '—'}|薪资${l.payroll}M${l.needs ? '|需:' + (Array.isArray(l.needs) ? l.needs.map(n => n.type + ':' + n.text).join('，') : l.needs) : ''}`;
  });
  snap.myDraftPicks = db.assets.filter(a => a.type === '选秀权').map(a => `${a.name}|动态价值:${pickAssetValue(a, db)}`);
  snap.dice = db.dice ? { turn: db.dice.turn, ...db.dice.rolls } : null;
  snap.events = db.events.slice(-8).map(e => `T${e.turn}|${e.title}|${e.detail}`);
  snap.rules = (db.rules || []).map(r => `${r.name}${num(r.value) ? '=' + r.value + (r.unit || '') : ''}(${r.effective || ''})`).join('；');
  snap.cap = { 工资帽: capOf(db), 奢侈税线: taxOf(db), 我队薪资总和: payrollOf(db, myTeam), 超帽: payrollOf(db, myTeam) > capOf(db), 超税: payrollOf(db, myTeam) > taxOf(db) };
  snap.freeAgentBoard = (db.freeAgents || []).slice(0, 12).map(f => `${f.name}|${f.pos}|${f.age}岁|OVR${f.ovr}|${f.trade_value}交易值${f.note ? '|注:' + f.note : ''}`);
  const draftYear = 2001 + db.meta.season;
  const inDraftWindow = String(db.meta.phase || '').includes('选秀');
  if (inDraftWindow || opts.forceProspects) {
    const cls = db.prospects.filter(p => p.year === draftYear);
    if (cls.length) snap.draftClass = cls.map(p => `${p.name}|${p.pos}|${p.age}岁|${p.inside_off}/${p.inside_def}/${p.outside_off}/${p.outside_def}|现值${p.ovr}/潜力${p.pot}|${p.origin}${p.note ? '|注:' + p.note : ''}`);
  }
  snap.turn = opts.turn;
  snap.revision = db.meta.revision ?? 0;
  snap.meta = { season: db.meta.season, date: db.meta.date, phase: db.meta.phase };
  let text = '【NBADB 已注入联盟数据库快照】\n<nbadb-state connected="true" confirmed="' + (db.manager.confirmed ? 'true' : 'false') + '" gameStarted="' + (db.meta.gameStarted ? 'true' : 'false') + '"/>\n'
    + JSON.stringify(snap) + '\n当前用户轮次：' + opts.turn
    + (inDraftWindow ? '\n（当前处于选秀窗口：draftClass为今年可选新秀全名单）' : '');
  text = RULE_TEXT + '\n\n' + text;
  if (text.length > INJECTION_CHAR_LIMIT) throw new Error(`注入快照超限：${text.length} > ${INJECTION_CHAR_LIMIT}字符`);
  return text;
}

/* ============ 联盟排名与选秀系统 ============ */
// 更新联盟排名（按胜场排序，分区前四锁定，其余按战绩）
export function updateLeagueStandings(db) {
  for (const conf of ['东部', '西部']) {
    const teams = db.league.filter(l => l.conference === conf);
    // 解析战绩 "33-49" → wins
    for (const l of teams) {
      if (typeof l.record === 'string' && l.record.includes('-')) {
        const [w, lo] = l.record.split('-').map(Number);
        l.wins = w; l.losses = lo;
      } else { l.wins = l.wins ?? 41; l.losses = l.losses ?? 41; }
    }
    teams.sort((a, b) => b.wins - a.wins);
    teams.forEach((l, i) => { l.rank = conf + (i + 1); l.rankNum = i + 1; });
  }
  // 选秀位：非季后赛球队按战绩倒序 + 乐透区
  const all = db.league.slice().sort((a, b) => b.wins - a.wins);
  const playoffCutoff = 16; // 29队中16队进季后赛
  all.forEach((l, i) => {
    l.leagueRank = i + 1; // 1=最强 29=最弱
    if (i >= playoffCutoff) l.expectedDraftPos = '乐透区(预计前14)';
    else l.expectedDraftPos = '第' + (i + 1 - playoffCutoff + 14) + '顺位(首轮)';
  });
  return db;
}

// NBA选秀乐透概率（13队，标准组合数/1000）
export const LOTTERY_ODDS = [250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 8, 7, 6];

// 模拟选秀抽签：按战绩加权随机，前3抽签+4-14按战绩倒序
export function runDraftLottery(db, seed) {
  updateLeagueStandings(db);
  const nonPlayoff = db.league.filter(l => l.leagueRank > 16).sort((a, b) => a.wins - b.wins);
  const playoff = db.league.filter(l => l.leagueRank <= 16).sort((a, b) => a.wins - b.wins);
  if (nonPlayoff.length < 13) nonPlayoff.push(...playoff.slice(-(13 - nonPlayoff.length)));
  const lottoTeams = nonPlayoff.slice(0, 13);
  // 简单确定性随机（seed可选）
  const rand = seed !== undefined ? (n) => ((seed * 9301 + 49297) % 233280) / 233280 * n : Math.random;
  // 抽前3
  const remaining = [...lottoTeams];
  const top3 = [];
  for (let i = 0; i < 3; i++) {
    const odds = remaining.map((_, idx) => LOTTERY_ODDS[idx]);
    const total = odds.reduce((s, v) => s + v, 0);
    const roll = rand(1) * total;
    let cum = 0, winner = 0;
    for (let j = 0; j < remaining.length; j++) { cum += odds[j]; if (roll < cum) { winner = j; break; } }
    top3.push(remaining.splice(winner, 1)[0]);
  }
  // 4-14按战绩倒序
  remaining.sort((a, b) => a.wins - b.wins);
  const order = [...top3, ...remaining];
  // 15-29 = 季后赛球队按战绩倒序
  const rest = db.league.filter(l => !order.includes(l)).sort((a, b) => a.wins - b.wins);
  const fullOrder = [...order, ...rest];
  fullOrder.forEach((l, i) => { l.draftPosition = i + 1; });
  return { order: fullOrder.map(l => ({ team: l.team, pos: l.draftPosition, wins: l.wins })), top3Jumps: top3.map((l, i) => ({ team: l.team, pick: i + 1, wins: l.wins })) };
}

// 球队未来实力评估（1-5分：5=光明未来，1=黑暗）
export function assessFutureStrength(teamName, db) {
  const roster = db.players.filter(p => p.team === teamName);
  if (!roster.length) return { score: 3, reasons: ['无阵容数据'] };
  const avgAge = roster.reduce((s, p) => s + p.age, 0) / roster.length;
  const youngCore = roster.filter(p => p.age <= 25 && (p.pot ?? 50) >= 78);
  const starCore = roster.filter(p => (p.trade_value ?? 0) >= 65);
  const expiringDeals = roster.filter(p => p.contract_years <= 1);
  const badContracts = roster.filter(p => (p.contract_total ?? 0) / Math.max(p.contract_years ?? 1, 1) > (p.trade_value ?? 0) * 0.5 && p.salary > 6);
  const payroll = payrollOf(db, teamName);
  const capSpace = capOf(db) - payroll;
  const picks = db.assets?.filter(a => a.type === '选秀权').length || 0;
  const reasons = [];
  let score = 3;
  // 年轻核心加分
  if (youngCore.length >= 2) { score += 1; reasons.push('年轻核心×' + youngCore.length + '(' + youngCore.map(p => p.name).slice(0, 2).join(',') + ')'); }
  else if (youngCore.length >= 1) { reasons.push('年轻核心×1(' + youngCore[0].name + ')'); }
  else { score -= 0.5; reasons.push('无25岁以下高潜核心'); }
  // 当打球星
  if (starCore.length >= 2) { score += 0.5; reasons.push('全明星级×' + starCore.length); }
  else if (starCore.length === 0) { score -= 0.5; reasons.push('无全明星级球员'); }
  // 帽空间
  if (capSpace > 10) { score += 0.5; reasons.push('帽空间' + capSpace.toFixed(1) + 'M（可追大牌）'); }
  else if (payroll > taxOf(db)) { score -= 0.5; reasons.push('超税' + (payroll - taxOf(db)).toFixed(1) + 'M'); }
  // 垃圾合同
  if (badContracts.length >= 2) { score -= 0.5; reasons.push('毒合同×' + badContracts.length + '(' + badContracts.map(p => p.name).slice(0, 2).join(',') + ')'); }
  // 平均年龄
  if (avgAge > 30) { score -= 0.5; reasons.push('平均年龄' + avgAge.toFixed(1) + '岁（老龄化）'); }
  else if (avgAge < 25) { reasons.push('平均年龄' + avgAge.toFixed(1) + '岁（成长期）'); }
  // 选秀权
  if (picks >= 8) { reasons.push('选秀权' + picks + '个'); }
  score = Math.max(1, Math.min(5, Math.round(score * 2) / 2));
  return { score, reasons, avgAge: Math.round(avgAge * 10) / 10, capSpace: Math.round(capSpace * 10) / 10, youngCore: youngCore.length, starCore: starCore.length, badContracts: badContracts.length };
}

// 动态选秀权价值：基于球队战绩 + 未来前景 + 年份 + 选秀大年
export function dynamicPickValue(asset, db) {
  const year = Number(String(asset.name).match(/(20\d\d)/)?.[1] || 2002);
  const currentYear = 2002 + (db.meta?.season || 0);
  const yearsAway = Math.max(0, year - currentYear);
  // 基础（状元80/首轮30/次轮8）
  const m = String(asset.name).match(/(状元|榜眼|探花|乐透|首轮|次轮)/);
  let base = m ? { 状元: 80, 榜眼: 65, 探花: 60, 乐透: 45, 首轮: 30, 次轮: 8 }[m[1]] : 20;
  // 从资产名提取球队（"XXXX年首轮签(来自XX队)"）或用我队
  const teamMatch = String(asset.name).match(/来自(.+?)队/);
  const teamName = teamMatch ? teamMatch[1] : db.manager?.team;
  const team = db.league.find(l => l.team === teamName);
  if (!team) return base;
  // 战绩修正：弱队签更值钱（预期顺位更高）
  const wins = team.wins ?? 41;
  const winPct = wins / 82;
  // 22胜(0.268) → 期望前5 → +60%；56胜(0.683) → 期望25+ → -40%
  const strengthAdj = 1 + (0.35 - winPct) * 1.6;  // 弱队(winPct<0.35)>1升值 / 强队(winPct>0.35)<1贬值
  // 未来实力修正：未来强=签更差=贬值
  const future = assessFutureStrength(teamName, db);
  const futureAdj = future.score >= 4.5 ? 0.75 : future.score >= 3.5 ? 0.9 : future.score >= 2.5 ? 1.0 : future.score >= 1.5 ? 1.15 : 1.3;
  // 年份折价（远期签）
  const yearDisc = Math.max(0.55, 1 - yearsAway * 0.12);
  // 选秀大年加成
  const draftClassBonus = year === 2003 ? 1.25 : year === 2004 ? 1.1 : year === 2002 ? 1.05 : 1.0;
  return Math.round(base * strengthAdj * futureAdj * yearDisc * draftClassBonus * 10) / 10;
}

// 耐久度(0-100) → 伤病倾向(0-100，越高越易伤)
export function calcInjuryProne(p) {
  let prone = 100 - (p.durability ?? 55);
  if (p.age >= 34) prone += (p.age - 33) * 2;
  if (p.age >= 38) prone += 8;
  if (p.injury && p.injury.includes('整季')) prone += 20;
  else if (p.injury && p.injury.length > 2) prone += 8;
  return Math.min(100, Math.max(0, Math.round(prone)));
}
export function injuryRiskLabel(prone) {
  if (prone >= 80) return '玻璃人'; if (prone >= 60) return '易伤';
  if (prone >= 40) return '偏高'; if (prone >= 20) return '普通'; return '钢铁之躯';
}
export function injuryRiskCheck(p) {
  const prone = calcInjuryProne(p);
  return { prone, label: injuryRiskLabel(prone), riskPer20G: Math.min(50, Math.round(prone * 0.4)) };
}

/* ============ 薪资总和(SUM)/工资帽/赛季合同结算 ============ */
export function floorOf(db) { return Math.round(capOf(db) * 0.75 * 10) / 10; }
export function ensureRules(db) {
  if (!db.rules) db.rules = [];
  if (!db.rules.find(r => r.id === 'floor')) {
    db.rules.push({ id: 'floor', name: '穷鬼线(最低薪资)', value: Math.round(capOf(db) * 0.75 * 10) / 10, unit: '百万美元', effective: '2001-02', detail: '球队薪资总和不得低于帽×75%（约3190万）——低于须补差额均分给现有球员' });
  }
  return db;
}
export function processRetirements(db) {
  const retired = [];
  const remaining = [];
  for (const p of db.players) {
    if (p.status === '退役') { retired.push(p); continue; }
    if (p.age >= 40) {
      p.status = '退役'; p.team = ''; p.salary = 0; p.contract_years = 0;
      retired.push(p);
      db.events.push({ eventId: 'retire-' + p.name, turn: 0, title: p.name + '退役', detail: p.age + '岁挂靴', kind: 'retirement' });
      continue;
    }
    if (p.age >= 36) {
      const decline = (p.pot ?? p.ovr) - p.ovr;
      let chance = (p.age - 35) * 0.15;
      if (decline > 25) chance += 0.2;
      if (p.injury && p.injury.includes('整季')) chance += 0.2;
      if (p.contract_years === 0) chance += 0.1;
      if (p.ovr < 55) chance += 0.15;
      if (Math.random() < chance) {
        p.status = '退役'; p.team = ''; p.salary = 0; p.contract_years = 0;
        retired.push(p);
        db.events.push({ eventId: 'retire-' + p.name, turn: 0, title: p.name + '退役', detail: p.age + '岁宣布退役', kind: 'retirement' });
        continue;
      }
    }
    remaining.push(p);
  }
  db.players = remaining;
  return retired;
}
export function payrollOf(db, team) { return Math.round((db.players || []).filter(p => p.team === team).reduce((s, p) => s + (p.salary || 0), 0) * 10) / 10; }
export function capOf(db) { const cap = (db.rules || []).find(r => r.id === 'cap'); return num(cap?.value) ? cap.value : 42.5; }
export function taxOf(db) { const tax = (db.rules || []).find(r => r.id === 'tax'); return num(tax?.value) ? tax.value : 54.5; }
// 赛季结算：全员合同年限-1；归零且无选项→入自由球员池；带选项→「选项待决」留队；重算各队薪资总和与名单数
export function finalizeSeason(db) {
  const kept = [];
  for (const p of db.players || []) {
    if (!int(p.contract_years)) p.contract_years = 2;
    if (p.contract_years <= 0) { kept.push(p); continue; } // 已是选项待决/特殊
    p.contract_years -= 1;
    if (p.contract_years === 0) {
      if (p.option) { p.status = '选项待决(' + p.option + ')'; p.note = (p.note ? p.note + '；' : '') + '休赛期由AI推演执行选项：执行=再续新约(settlement写contract_years/salary)，不执行=入自由球员池'; kept.push(p); }
      else {
        p.team = ''; p.salary = 0; p.contract_total = 0; p.status = '自由球员';
        p.note = (p.note ? p.note + '；' : '') + '合同到期进入自由球员市场';
        if (!(db.freeAgents || []).some(f => f.name === p.name)) db.freeAgents.push(p);
      }
    } else kept.push(p);
  }
  db.players = kept;
  // 签约自由球员出池：freeAgents中被settlement赋回球队的由applyRow处理；此处清理仍带队的残留
  db.freeAgents = (db.freeAgents || []).filter(f => !f.team && f.status !== '退役');
  processRetirements(db);
  for (const l of db.league || []) {
    l.payroll = payrollOf(db, l.team);
    l.rosterSize = db.players.filter(pp => pp.team === l.team).length;
  }
  return db;
}

/* ============ 选秀权资产（近6年窗口，赛季滚动自动补充） ============ */
export function ensureDraftAssets(db) {
  const my = db.manager.team;
  if (!my || TEAM_NAMES.includes(my) === false) return db;
  const baseYear = 2002 + (db.meta.season || 0);
  const years = [baseYear, baseYear + 1, baseYear + 2, baseYear + 3, baseYear + 4, baseYear + 5];
  const names = new Set(db.assets.map(a => a.name));
  for (const y of years) {
    for (const rd of ['首轮', '次轮']) {
      const name = y + '年' + rd + '签(自有)';
      if (!names.has(name)) db.assets.push({ name, type: '选秀权', detail: '自有', value: rd === '首轮' ? 25 : 5, note: '' });
    }
  }
  if (!db.rules.find(r => r.id === 'durability')) {
    db.rules.push({ id: 'durability', name: '耐久与伤病倾向', value: 0, unit: '', effective: '2001-02', detail: '耐久(0-100)越高越抗伤；伤病倾向=(100-耐久)+年龄修正+伤史修正。耐久<40=易伤(交易价值×0.8)；耐久≥85=铁人(×1.05)；耐久<25退役概率+25%' });
  }
  return db;
};

/* ============ 交易搜索器（正向/反向/组合方案+NBA规则校验） ============ */
const PICK_VALUE = { 状元: 80, 榜眼: 65, 探花: 60, 乐透: 45, 首轮: 30, 次轮: 8 };
function pickAssetValue(a, db) {
  if (db) return dynamicPickValue(a, db);
  const m = String(a.name || '').match(/(状元|榜眼|探花|乐透|首轮|次轮)/);
  const base = m ? PICK_VALUE[m[1]] : 20;
  return base;
}
function assetToPiece(db, a, needs) {
  const isPick = a.type === '选秀权' || /签/.test(String(a.name));
  const piece = { name: a.name, kind: isPick ? '选秀权' : a.type, value: isPick ? pickAssetValue(a) : (num(a.value) ? a.value : 5), salary: 0, __isPick: isPick };
  if (!isPick) {
    const p = db.players.find(x => x.name === a.name);
    if (p) return { name: a.name, kind: '球员', value: offerValueTo(p, needs), salary: p.salary ?? 0, pos: p.pos, age: p.age };
  }
  return piece;
}
export function tradeSearch(db, opts = {}) {
  const my = db.manager.team;
  const myPlayers = db.players.filter(p => p.team === my);
  // 方案A 反向：想要对方球员/资产（want: [名字]）→ 我方凑包
  // 方案B 正向：以我方筹码（offer: [名字/资产名]）→ 换回等值目标
  const results = [];
  const wants = (opts.want || []).map(String);
  const offers = (opts.offer || []).map(String);
  const maxResults = opts.maxResults || 6;
  if (wants.length) {
    for (const want of wants) {
      const target = db.players.find(p => p.name === want);
      if (!target) { results.push({ want, error: '球员不在库中' }); continue; }
      const theirTeam = db.league.find(l => l.team === target.team);
      if (theirTeam?.team === my) { results.push({ want, error: '已是本队球员' }); continue; }
      const needs = normalizeNeeds(theirTeam?.needs);
      const asking = askingValueOf(target);
      const incomingSalary = target.salary ?? 0;
      // 层级门槛：超级巨星须1入阵或2全明星回报；入阵须1全明星回报
      const tier = tradeTier(effectiveTradeValue(target));
      const req = tierRequirement(effectiveTradeValue(target));
      if (req) {
        results.push({ want, from: target.team, asking, tier, requirement: req, note: 'AI须验证我方筹码是否满足层级门槛后才能推进' });
      }
      // 枚举我方筹码组合（1-3名球员+0-2个选秀权资产）
      const pool = myPlayers.filter(p => p.name !== want)
        .map(p => ({ name: p.name, kind: '球员', base: tradeValueOf(p), value: offerValueTo(p, needs), salary: p.salary ?? 0 }))
        .sort((a, b) => b.value - a.value).slice(0, 14);
      const pickPool = db.assets.filter(a => a.type === '选秀权')
        .map(a => ({ name: a.name, kind: '选秀权', base: pickAssetValue(a, db), value: (normalizeNeeds(needs).some(n => /选秀权/.test(n.text)) ? pickAssetValue(a, db) * 1.1 : pickAssetValue(a, db)), salary: 0 }))
        .sort((a, b) => b.value - a.value).slice(0, 6);
      const combos = [];
      const dfs = (idx, picked, value, salary, picksUsed) => {
        if (combos.length > 400) return;
        if (picked.length >= 1) combos.push({ give: [...picked], value: Math.round(value * 10) / 10, salary: Math.round(salary * 10) / 10 });
        if (picked.length >= 3) return;
        for (let i = idx; i < pool.length; i++) dfs(i + 1, [...picked, pool[i].name], value + pool[i].value, salary + pool[i].salary, picksUsed);
        if (picksUsed < 2) for (const pk of pickPool) if (!picked.includes(pk.name)) dfs(pool.length, [...picked, pk.name], value + pk.value, salary, picksUsed + 1);
      };
      dfs(0, [], 0, 0, 0);
      combos.sort((a, b) => a.value - b.value);
      const band = combos.filter(c => c.value >= asking * 0.92 && c.value <= asking * 1.35).slice(0, 2)
        .concat(combos.filter(c => c.value > asking * 1.35).sort((a, b) => a.value - b.value).slice(0, 1));
      for (const c of band) {
        const mode = c.value >= asking * 1.10 ? '必定' : '概率';
        results.push({ want, from: target.team, asking, give: c.give, myValue: c.value, mode, checks: tradeRuleChecks(db, c.salary, incomingSalary, c.give, 1) });
      }
      if (!results.some(r => r.want === want && !r.error)) results.push({ want, from: target.team, asking, note: '我方可交易价值不足以覆盖要价（含溢价）', myMax: combos.at(-1)?.value ?? 0 });
    }
  }
  if (offers.length) {
    const pieces = offers.map(name => {
      const a = db.assets.find(x => x.name === name);
      if (a) return { name, salary: 0, val: pickAssetValue(a) };
      const p = myPlayers.find(x => x.name === name) || db.players.find(x => x.name === name);
      if (!p) return null;
      return { name, salary: p.salary ?? 0, val: askingValueOf(p) };
    }).filter(Boolean);
    if (pieces.length) {
      const totalValue = Math.round(pieces.reduce((s, x) => s + x.val, 0) * 10) / 10;
      const totalSalary = Math.round(pieces.reduce((s, x) => s + x.salary, 0) * 10) / 10;
      const targets = db.players.filter(p => p.team !== my).map(p => ({ p, asking: askingValueOf(p) })).filter(x => x.asking <= totalValue * 0.92 && x.asking >= totalValue * 0.45).sort((a, b) => b.asking - a.asking).slice(0, maxResults);
      for (const x of targets) {
        const mode = totalValue >= x.asking * 1.10 ? '必定' : '概率';
        results.push({ offer: offers, get: x.p.name, from: x.p.team, asking: x.asking, myValue: totalValue, mode, checks: tradeRuleChecks(db, totalSalary, x.p.salary ?? 0, offers, 1) });
      }
      if (!results.length) results.push({ offer: offers, myValue: totalValue, note: '无合适目标（区间45%-92%），可调整筹码' });
    }
  }
  return results;
}
// NBA交易规则校验：超帽薪资匹配115%+10万 / 名单12-15人 / Stepien规则 / 现金上限
export function tradeRuleChecks(db, outSalary, inSalary, outNames, headcount) {
  const my = db.manager.team;
  const myPay = payrollOf(db, my);
  const overCap = myPay > capOf(db);
  const outCount = outNames.filter(n => db.players.some(p => p.name === n && p.team === my)).length;
  const roster = db.players.filter(p => p.team === my).length;
  const salaryOK = !overCap || outSalary * 1.15 + 0.1 >= inSalary;
  const rosterOKAfter = roster - outCount + headcount;
  const rosterOK = rosterOKAfter >= 12 && rosterOKAfter <= 15;
  const firstYears = outNames.map(n => Number(String(n).match(/(20\d\d)年首轮/)?.[1] || 0)).filter(Boolean).sort((a, b) => a - b);
  let stepien = true;
  for (let i = 0; i + 1 < firstYears.length; i++) if (firstYears[i + 1] - firstYears[i] === 1) stepien = false;
  const cash = outNames.filter(n => /现金/.test(String(n))).length;
  return { 薪资匹配: salaryOK ? '通过' : ('不通过：送出' + outSalary + 'M×115%+10万 < 得到' + inSalary + 'M'), 名单人数: rosterOK ? '通过(' + rosterOKAfter + '人)' : '违规(交易后' + rosterOKAfter + '人，须12-15)', Stepien规则: stepien ? '通过' : '警告：连续送出相邻年份首轮签', 现金上限: cash <= 1 ? '通过(≤300万/赛季)' : '超限' };
}

/* ============ 数据导入 ============ */
export function importLeagueSnapshot(db, snapshot) {
  if (!snapshot || snapshot.meta?.type !== 'nbadb-league-snapshot' || !Array.isArray(snapshot.league) || !Array.isArray(snapshot.players)) throw new Error('非法联盟快照（缺少meta.type/league/players）');
  const teams = new Set(snapshot.league.map(l => l.team));
  if (teams.size !== 29) throw new Error('联盟快照须为29队，收到' + teams.size);
  for (const p of snapshot.players) {
    if (!p.name || !p.team || !teams.has(p.team)) throw new Error('快照球员非法：' + (p && p.name));
    p.ovr = int(p.ovr) ? p.ovr : calcOvr(p.pos, p.inside_off, p.inside_def, p.outside_off, p.outside_def);
  }
  const next = structuredClone(db);
  next.league = structuredClone(snapshot.league).map(l => ({ ...l, needs: normalizeNeeds(l.needs) }));
  next.players = structuredClone(snapshot.players).map(p2 => normalizePlayerRow({ ...p2 }, undefined));
  next.freeAgents = structuredClone(snapshot.freeAgents || []).map(f => normalizePlayerRow({ ...f, team: '', status: '自由球员' }, undefined));
  next.rules = structuredClone(snapshot.rules || []);
  next.meta.season = 0;
  next.meta.date = snapshot.meta.date || '2001-06-01';
  next.meta.phase = snapshot.meta.phase || '休赛期·选秀前夜';
  validateDb(next);
  return next;
}

export function importProspectsPool(db, pool) {
  if (!pool || pool.meta?.type !== 'nbadb-prospects-pool' || !pool.classes || typeof pool.classes !== 'object') throw new Error('非法新秀池（缺少meta.type/classes）');
  const rows = [];
  for (const [year, list] of Object.entries(pool.classes)) {
    if (!Array.isArray(list)) throw new Error('新秀班非法：' + year);
    for (const p of list) {
      if (!p.name) throw new Error('新秀缺少name');
      rows.push({ year: Number(year), name: p.name, pos: p.pos, age: p.age, inside_off: p.inside_off, inside_def: p.inside_def, outside_off: p.outside_off, outside_def: p.outside_def, ovr: int(p.ovr) ? p.ovr : calcOvr(p.pos, p.inside_off, p.inside_def, p.outside_off, p.outside_def), pot: p.pot, trade_value: num(p.trade_value) ? p.trade_value : tradeValueOf({ ovr: int(p.ovr) ? p.ovr : calcOvr(p.pos, p.inside_off, p.inside_def, p.outside_off, p.outside_def), age: p.age, pot: p.pot }), origin: p.origin || '', note: p.note || '' });
    }
  }
  const next = structuredClone(db);
  next.prospects = rows;
  validateDb(next);
  return next;
}

/* ============ 表格排序/筛选（Excel语义，纯逻辑） ============ */
// 三态排序：null（默认）→asc→desc→null（还原）
export function nextSortState(cur) { return cur === null || cur === undefined ? 'asc' : cur === 'asc' ? 'desc' : null; }
// 排序：数值列按数值、文本列按中文localeCompare；空值排最后（Excel习惯）
export function sortRows(rows, keys, sort) {
  if (!sort || !sort.key || !sort.dir) return rows;
  const key = sort.key;
  if (!keys.includes(key)) return rows;
  const vals = rows.map(r => String(r[key] ?? '').trim());
  const allNum = vals.every(v => v === '' || !Number.isNaN(Number(v)));
  const dir = sort.dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const av = String(a[key] ?? '').trim(), bv = String(b[key] ?? '').trim();
    if (av === '' && bv !== '') return 1;
    if (bv === '' && av !== '') return -1;
    if (allNum) return (Number(av) - Number(bv)) * dir;
    return av.localeCompare(bv, 'zh-Hans-CN') * dir;
  });
}
// 筛选：列内多选OR，列间AND（Excel自动筛选语义）；filters={key:Set(允许值)}
export function filterRows(rows, filters) {
  const active = Object.entries(filters || {}).filter(([, s]) => s && s.size > 0);
  if (!active.length) return rows;
  return rows.filter(r => active.every(([k, allowed]) => allowed.has(String(r[k] ?? '').trim())));
}
// 去重值列表（数值列按数值升序，否则中文排序）
export function uniqueColumnValues(rows, key) {
  return [...new Set(rows.map(r => String(r[key] ?? '').trim()).filter(v => v !== ''))]
    .sort((a, b) => { const na = Number(a), nb = Number(b); if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb; return a.localeCompare(b, 'zh-Hans-CN'); });
}

/* ============ 交易价值体系 ============ */
// 交易价值：仅基于当季表现与可感知天赋（球探共识），不使用pot真值——除主角外无人知晓未来
// 感知上限：年轻球员的成长预期被压缩到+12/+6（字母哥2001年这种"看不破"的沉睡者自然被低估）
export function tradeValueOf(p) {
  const ovr = p.ovr ?? 50;
  const age = p.age ?? 25;
  // 2001标定曲线：全明星以上~35人/首发~40/替补~20/边缘个位数
  let tv;
  if (ovr >= 93) tv = 125 + (ovr - 93) * 8;             // 超级巨星 125+
  else if (ovr >= 90) tv = 110 + (ovr - 89) * 5;        // 准超级 110-125
  else if (ovr >= 86) tv = 95 + (ovr - 85) * 5;         // 入阵 95-110
  else if (ovr >= 80) tv = 88 + (ovr - 79) * 1.4;       // 全明星中上 88-95（OVR 80→89.4, 85→96.4）
  else if (ovr >= 76) tv = 82 + (ovr - 75) * 1.5;       // 全明星入门 82-88（OVR 76→83.5, 79→88）
  else if (ovr >= 71) tv = 65 + (ovr - 70) * 3.4;       // 准全明星 65-82（OVR 71→68.4, 75→82）
  else if (ovr >= 67) tv = 40 + (ovr - 66) * 6.25;      // 首发 40-65（OVR 67→46.3, 70→65）
  else if (ovr >= 62) tv = 22 + (ovr - 61) * 3.6;       // 轮换替补 22-40（OVR 62→25.6, 66→40）
  else if (ovr >= 56) tv = 10 + (ovr - 55) * 2;         // 深度替补 10-22
  else if (ovr >= 46) tv = 3 + (ovr - 45) * 0.7;        // 边缘 3-10
  else tv = Math.max(1, ovr * 0.06);                    // 饮水机 1-3
  // 年轻上升期（感知潜力，非真值）
  if (age <= 22) tv += Math.min(Math.max((p.pot ?? ovr) - ovr, 0) * 0.8, 15);
  else if (age <= 25) tv += Math.min(Math.max((p.pot ?? ovr) - ovr, 0) * 0.4, 8);
  // 老将折价（温和：Malone 38仍准全明星）
  if (age >= 38) tv *= 0.6;
  else if (age >= 36) tv *= 0.75;
  else if (age >= 34) tv *= 0.87;
  // 伤病折价
  if (p.injury && p.injury.includes('整季')) tv *= 0.2;
  else if (p.injury && p.injury.includes('长期')) tv *= 0.45;
  else if (p.injury && p.injury.length > 2) tv *= 0.7;
  return Math.round(tv * 10) / 10;
}
// 公平薪资（与2001顶薪结构匹配：巨星顶薪合法区15-25M不算溢价）
export function fairSalary(tv) {
  if (tv >= 100) return 22;  // 超级巨星顶薪合法区
  if (tv >= 82) return 14;   // 全明星接近顶薪
  if (tv >= 65) return 9;    // 准全明星
  if (tv >= 40) return 5.5;  // 首发
  if (tv >= 22) return 3;    // 轮换
  if (tv >= 10) return 1.5;  // 深度
  return 0.8;                // 边缘
}
// 合同毒性（负交易价值）：仅非全明星可负值；全明星以上最多扣到基础值50%
export function contractToxicity(p) {
  const tv = p.trade_value ?? tradeValueOf(p);
  if (tv >= 82) return 0; // 全明星以上：顶薪合法区，无毒
  const fair = fairSalary(tv);
  const excess = (p.salary ?? 0) - fair;
  if (excess <= 0) return 0;
  const years = p.contract_years ?? 1;
  return -Math.round(excess * years * 1.2 * 10) / 10;
}
// 综合交易价值（可为负=垃圾合同）
export function effectiveTradeValue(p) {
  const base = tradeValueOf(p);
  const tox = contractToxicity({ ...p, trade_value: base });
  return Math.round((base + tox) * 10) / 10;
}
// 要价溢价
export function askingValueOf(p) {
  let v = effectiveTradeValue(p);
  if (v <= 0) return v;
  if (p.untouchable) v *= 1.5;
  else if (p.core_asset) v *= 1.15;
  return Math.round(v * 10) / 10;
}
// 我方筹码对特定球队升值
export function offerValueTo(p, needs = []) {
  const base = effectiveTradeValue(p);
  if (base <= 0) return base;
  const label = String(p.name || '');
  const pos = p.pos || '';
  for (const n of needs) {
    if (!n || !n.text) continue;
    const text = String(n.text);
    if (n.type === '指定') { if (text.includes(label)) return Math.round(base * 1.2 * 10) / 10; }
    else {
      if (text.includes(label)) return Math.round(base * 1.1 * 10) / 10;
      if (/大前锋|四号位/.test(text) && pos === 'PF') return Math.round(base * 1.1 * 10) / 10;
      if (/中锋|五号位|护框/.test(text) && pos === 'C') return Math.round(base * 1.1 * 10) / 10;
      if (/控卫|组织/.test(text) && pos === 'PG') return Math.round(base * 1.1 * 10) / 10;
      if (/分卫|射手|得分后卫/.test(text) && pos === 'SG') return Math.round(base * 1.1 * 10) / 10;
      if (/小前锋|三号位/.test(text) && pos === 'SF') return Math.round(base * 1.1 * 10) / 10;
      if (/年轻|潜力|新秀/.test(text) && (p.age ?? 25) <= 23) return Math.round(base * 1.1 * 10) / 10;
      if (/选秀权/.test(text) && p.__isPick) return Math.round(base * 1.1 * 10) / 10;
    }
  }
  return base;
}
// 层级判定
export function tradeTier(tv) {
  if (tv >= 120) return '超级巨星';
  if (tv >= 95) return '入阵';
  if (tv >= 82) return '全明星';
  if (tv >= 65) return '准全明星';
  if (tv >= 38) return '首发';
  if (tv >= 15) return '替补';
  return '边缘';
}
// 层级门槛：全明星以上须对应级别回报
export function tierRequirement(tv) {
  const tier = tradeTier(tv);
  if (tier === '超级巨星') return '回报须含≥1入阵(TV≥95)或≥2全明星(TV≥82)';
  if (tier === '入阵') return '回报须含≥1全明星(TV≥82)';
  if (tier === '全明星') return '回报须含≥1准全明星(TV≥65)';
  return '';
}
export function playerValue(p) { return tradeValueOf(p); }
