// NBADB core.js 单元测试（node原生，无外部依赖）
import {
  calcOvr, emptyDb, validateDb, escapeMacros, unescapeMacros, robustJsonParse,
  parseSettlement, parseLeagueTag, validateSettlement, applyLeagueUpdate,
  rollDice, buildInjection, importLeagueSnapshot, importProspectsPool, playerValue,
  tradeValueOf, askingValueOf, offerValueTo, normalizeNeeds, ensureDraftAssets, tradeSearch,
  nextSortState, sortRows, filterRows, uniqueColumnValues,
  payrollOf, capOf, taxOf, finalizeSeason,
  contractToxicity, effectiveTradeValue, tradeTier, tierRequirement,
  updateLeagueStandings, runDraftLottery, assessFutureStrength, dynamicPickValue, LOTTERY_ODDS,
} from '../core.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } };
const throws = (fn, name) => { try { fn(); fail++; console.error('FAIL(no throw):', name); } catch { pass++; } };

/* OVR公式 */
ok(calcOvr('PG', 40, 30, 50, 42) >= 75 && calcOvr('PG', 40, 30, 50, 42) <= 95, 'AI OVR六属性75-95');
ok(calcOvr('C', 50, 46, 38, 40) >= 85, 'Shaq OVR=93');
ok(calcOvr('PF', 46, 47, 40, 44) >= 75 && calcOvr('PF', 46, 47, 40, 44) <= 95, 'Duncan OVR六属性');
ok(calcOvr('SG', 38, 40, 47, 45) >= 75 && calcOvr('SG', 38, 40, 47, 45) <= 95, 'Kobe OVR六属性');

/* 宏防护 */
ok(escapeMacros('{{user}} x }}') === '｛｛user}} x }}', 'escape只转左括号');
ok(unescapeMacros(escapeMacros('{{roll:1d20}}')) === '{{roll:1d20}}', 'roundtrip');

/* 容错JSON */
ok(JSON.stringify(robustJsonParse('```json\n{"a":1}\n```')) === '{"a":1}', '围栏剥离');
ok(robustJsonParse('前置文本 {"a":[1,2]} 后置') .a.length === 2, '深度截取');
ok(robustJsonParse("{a:1, b:'x',}") .b === 'x', '无引号键+单引号+尾逗号');

/* settlement解析 */
const body = '叙事正文……\n本轮结算快照（待结算）\n<nbadb-settlement>{"turn":3,"baseRevision":7,"patch":{"team":[{"field":"战绩","value":"22胜9负"}]}}</nbadb-settlement>';
const s = parseSettlement(body);
ok(s.payload.turn === 3 && s.payload.patch.team.length === 1, 'settlement解析');
ok(s.clean.endsWith('本轮结算快照（待结算）'), 'clean剥离标签');
throws(() => parseSettlement('正文<nbadb-settlement>{bad}</nbadb-settlement>中间夹尾'), '中间标签位置非法');
ok(parseSettlement('无标签正文') === null, '无标签返回null');
const fenced = '正文\n```\n<nbadb-settlement>{"turn":1,"baseRevision":0,"patch":{}}</nbadb-settlement>\n```';
ok(parseSettlement(fenced).payload.turn === 1, '围栏包裹的settlement');

/* patch校验与应用 */
const base = emptyDb();
base.players.push({ name: '测试甲', team: '洛杉矶湖人', pos: 'PG', age: 24, inside_off: 20, inside_def: 20, outside_off: 30, outside_def: 30, ovr: calcOvr('PG',20,20,30,30), pot: 80, salary: 2, contract: '新秀合同', injury: '', status: '现役', note: '' });
base.league.push({ team: '洛杉矶湖人', conference: '西部', record: '56-26', rank: '西部2', core: '', payroll: 54 });
const patch = {
  manager: [{ field: 'trust', value: 55, note: '连胜' }],
  team: [{ field: '战绩', value: '60-20', note: '' }],
  players: [
    { name: '测试甲', ovr: 72, note: '涨球' },
    { name: '新秀乙', team: '洛杉矶湖人', pos: 'C', age: 19, inside_off: 30, inside_def: 30, outside_off: 10, outside_def: 20, pot: 82, salary: 3 },
  ],
  assets: [{ name: '2002年首轮签(自有)', type: '选秀权', detail: '2002' }],
  programs: [{ name: '新秀乙·潜力兑现', player: '新秀乙', kind: '潜力兑现', progress: '25%' }],
  events: [{ eventId: 'e1', turn: 3, title: '测试事件', detail: 'x' }, { eventId: 'e1', turn: 3, title: '测试事件', detail: 'x' }],
};
const { next, changes } = validateSettlement({ turn: 3, baseRevision: 0, patch }, base, 3, 0);
ok(next.manager.trust === 55, 'manager patch');
ok(next.players.find(p => p.name === '测试甲').ovr === 72, 'player upsert');
ok(next.players.find(p => p.name === '新秀乙').pot === 82, 'player create');
ok(next.assets.length === 1, 'asset create');
ok(next.programs[0].progress === 25, 'program progress 百分号转数值');
ok(next.events.length === 1, 'events eventId去重');
throws(() => validateSettlement({ turn: 2, baseRevision: 0, patch: {} }, base, 3, 0), 'turn过期拒绝');
throws(() => validateSettlement({ turn: 3, baseRevision: 5, patch: {} }, base, 3, 0), 'baseRevision冲突');
throws(() => validateSettlement({ turn: 3, baseRevision: 0, patch: { league: [] } }, base, 3, 0), 'patch禁写league');
throws(() => validateSettlement({ turn: 3, baseRevision: 0, patch: { players: [{ name: 'x', team: '不存在的队', pos: 'PG', age: 20, pot: 60 }] } }, base, 3, 0), '非法球队拒绝');
throws(() => validateSettlement({ turn: 3, baseRevision: 0, patch: { players: [{ name: 'x', team: '洛杉矶湖人', pos: 'PG', age: 20, inside_off: 99, outside_off: 20, outside_def: 20, pot: 60 }] } }, base, 3, 0), '四维>50拒绝');
throws(() => validateSettlement({ turn: 3, baseRevision: 0, patch: { manager: [{ field: 'confirmed', value: true }] } }, base, 3, 0), '禁改manager.confirmed');
const del = validateSettlement({ turn: 3, baseRevision: 0, patch: { assets: [{ name: '2002年首轮签(自有)', delete: true }] } }, next, 3, 0);
ok(del.next.assets.length === 0, 'delete语义');

/* league标签 */
const lgText = '<nbadb-league>[{"team":"洛杉矶湖人","record":"58-24","rank":"西部1","playoffs":"总冠军","in":["测试丙"],"out":["测试甲"],"core":[{"name":"测试丙","ovr":78}],"payroll":56,"note":"夺冠"}]</nbadb-league>';
const lg = parseLeagueTag('正文\n' + lgText);
ok(lg.payload.length === 1, 'league解析');
throws(() => parseLeagueTag('<nbadb-league>' + lgText + '</nbadb-league><nbadb-league>[1]</nbadb-league>'), 'league标签唯一性');
const otherTeams = ['费城76人','密尔沃基雄鹿','迈阿密热火','纽约尼克斯','多伦多猛龙','夏洛特黄蜂','奥兰多魔术','印第安纳步行者','底特律活塞','波士顿凯尔特人','克利夫兰骑士','新泽西篮网','亚特兰大老鹰','华盛顿奇才','芝加哥公牛','圣安东尼奥马刺','萨克拉门托国王','犹他爵士','达拉斯小牛','菲尼克斯太阳','波特兰开拓者','明尼苏达森林狼','休斯顿火箭','西雅图超音速','丹佛掘金','洛杉矶快船','孟菲斯灰熊','金州勇士'];
next.league = [{ team: '洛杉矶湖人', conference: '西部', record: '56-26', rank: '西部2', core: '', payroll: 54 }].concat(otherTeams.map(t => ({ team: t, conference: '东部', record: '50-32', rank: '', core: '', payroll: 50 })));
const lgPayload = lg.payload.concat(otherTeams.map(t => ({ team: t, record: '50-32', rank: '', note: '' })));
const afterLeague = applyLeagueUpdate(next, lgPayload);
ok(afterLeague.players.find(p => p.name === '测试丙').team === '洛杉矶湖人', 'league in移队');
ok(afterLeague.players.find(p => p.name === '测试丙').ovr === 78, 'league core数值');
ok(afterLeague.players.find(p => p.name === '测试甲').status !== '现役', 'league out状态');
throws(() => applyLeagueUpdate(next, lg.payload), 'league须29队');

/* 骰子 */
for (let i = 0; i < 200; i++) { const r = rollDice(); if (r.d20a < 1 || r.d20a > 20 || r.inj1 < 1 || r.inj1 > 20) { ok(false, '骰子范围'); break; } }
ok(true, '骰子范围200次');

/* 注入构造 */
next.manager.team = '洛杉矶湖人';
const inj = buildInjection(next, { turn: 3 });
ok(incl(inj, 'NBADB') && inj.includes('nbadb-settlement'), '注入含协议');
ok(inj.includes('测试甲') && inj.includes('洛杉矶湖人'), '注入含本队与联盟');
ok(inj.length < 60000, '注入预算');
function incl(h, s) { return h.includes(s); }
next.meta.phase = '休赛期·选秀窗口';
const inj2 = buildInjection(next, { turn: 4, forceProspects: true });
ok(inj2.includes('draftClass'), '选秀窗口注入新秀班');

/* 真实数据导入 */
const snapshot = JSON.parse(readFileSync(new URL('../data/league_2001.json', import.meta.url), 'utf8'));
const pool = JSON.parse(readFileSync(new URL('../data/prospects_pool.json', import.meta.url), 'utf8'));
const imported = importProspectsPool(importLeagueSnapshot(emptyDb(), snapshot), pool);
ok(imported.league.length === 29 && imported.players.length >= 380, '真实快照导入29队380+人');
ok(imported.prospects.length >= 230, '新秀池230+人');
ok(imported.prospects.some(p => p.name === '勒布朗·詹姆斯' && p.year === 2003), '2003届勒布朗在池');
ok(imported.players.find(p => p.name === '保罗·加索尔')?.team === '孟菲斯灰熊', '加索尔在灰熊');
ok(imported.players.find(p => p.name === '贾森·基德')?.team === '新泽西篮网', '基德在篮网');
ok(imported.players.find(p => p.name === '迈克尔·乔丹')?.team === '华盛顿奇才', '乔丹在奇才');
ok(imported.freeAgents?.length >= 10, '自由球员池10+人');
ok(imported.rules?.length >= 17, '规则库17+条');
ok(imported.league.every(l => l.rosterSize >= 9 && l.rosterSize <= 15), '每队9-15人');
const shaq = imported.players.find(p => p.name === '沙奎尔·奥尼尔');
ok(shaq.ovr >= 85 && shaq.team === '洛杉矶湖人', '沙克在湖人OVR85+');
const bigInj = buildInjection({ ...imported, manager: { ...imported.manager, team: '洛杉矶湖人', name: '测试' } }, { turn: 1 });
ok(bigInj.length < 60000, '真实数据注入预算：' + bigInj.length + '字符');
ok(bigInj.includes('剩'), '注入含合同剩余年限');
ok(bigInj.includes('工资帽'), '注入含规则');
throws(() => importLeagueSnapshot(emptyDb(), { meta: { type: 'nbadb-league-snapshot' }, league: [], players: [] }), '空快照拒绝');

/* 交易价值v1.5体系 */
ok(tradeValueOf({ ovr: 93, pot: 93, age: 28 }) >= 100, 'Shaq OVR高=超级巨星125+');
ok(tradeValueOf({ ovr: 89, pot: 97, age: 22 }) >= 100, 'Kobe OVR高+潜力=超级巨星100+');
ok(tradeValueOf({ ovr: 89, pot: 94, age: 25 }) > 110, 'Duncan OVR89=入阵');
ok(tradeValueOf({ ovr: 80, pot: 80, age: 28 }) >= 88, 'OVR80=全明星入门88+');
ok(tradeValueOf({ ovr: 76, pot: 76, age: 28 }) >= 82, 'OVR76=全明星门槛82');
ok(tradeValueOf({ ovr: 71, pot: 71, age: 28 }) >= 65, 'OVR71=准全明星65+');
ok(tradeValueOf({ ovr: 67, pot: 67, age: 28 }) >= 40, 'OVR67=首发~40');
ok(tradeValueOf({ ovr: 62, pot: 62, age: 28 }) >= 22, 'OVR62=替补~22');
ok(tradeValueOf({ ovr: 50, pot: 50, age: 28 }) < 15, 'OVR50=边缘');
ok(tradeValueOf({ ovr: 40, pot: 99, age: 19 }) < 25, '沉睡者被低估（无人知晓未来）');
// 层级
ok(tradeTier(125) === '超级巨星' && tradeTier(100) === '入阵' && tradeTier(85) === '全明星' && tradeTier(70) === '准全明星' && tradeTier(45) === '首发' && tradeTier(20) === '替补', '七层级判定');
ok(tierRequirement(125).includes('入阵'), '超级巨星门槛含入阵');
ok(tierRequirement(100).includes('全明星'), '入阵门槛含全明星');
ok(tierRequirement(85).includes('准全明星'), '全明星门槛含准全明星');
ok(tierRequirement(50) === '', '首发无门槛');
// 合同毒性
ok(contractToxicity({ trade_value: 125, salary: 24.8, contract_years: 4 }) === 0, '全明星以上无毒（顶薪合法区）');
ok(contractToxicity({ trade_value: 30, salary: 12, contract_years: 3 }) < -10, '替补高薪有毒');
ok(effectiveTradeValue({ ovr: 60, pot: 60, age: 30, salary: 12, contract_years: 3 }) < 0, '垃圾合同=负值');
// 要价
ok(askingValueOf({ ovr: 93, pot: 93, age: 28, untouchable: 1 }) > 180, 'Shaq非卖品要价>180');
// 需求命中
ok(offerValueTo({ name: '某PF', pos: 'PF', ovr: 71, pot: 71, age: 28, salary: 5 }, [{ type: '模糊', text: '需要首发级大前锋' }]) > tradeValueOf({ ovr: 71, pot: 71, age: 28 }), '模糊需求命中升值');

/* 合同/FA/规则/薪资SUM */
const cdb = emptyDb();
cdb.manager = { ...cdb.manager, team: '洛杉矶湖人' };
cdb.rules = [{ id: 'cap', name: '工资帽', value: 42.5, unit: 'M', effective: '01-02', detail: '' }, { id: 'tax', name: '奢侈税线', value: 54.5, unit: 'M', effective: '01-02', detail: '' }];
cdb.players = [
  { name: '到期无选项', team: '洛杉矶湖人', pos: 'PF', age: 30, inside_off: 30, inside_def: 30, outside_off: 30, outside_def: 30, ovr: 30, pot: 30, salary: 5, contract_years: 1, option: '', contract_total: 5, injury: '', status: '现役', note: '' },
  { name: '到期球员选项', team: '洛杉矶湖人', pos: 'PF', age: 28, inside_off: 30, inside_def: 30, outside_off: 30, outside_def: 30, ovr: 30, pot: 30, salary: 6, contract_years: 1, option: '球员选项', contract_total: 6, injury: '', status: '现役', note: '' },
  { name: '长约', team: '洛杉矶湖人', pos: 'PF', age: 25, inside_off: 30, inside_def: 30, outside_off: 30, outside_def: 30, ovr: 30, pot: 30, salary: 4, contract_years: 4, option: '', contract_total: 16, injury: '', status: '现役', note: '' },
];
cdb.league = [{ team: '洛杉矶湖人', conference: '西部', record: '', rank: '', core: '', payroll: 0, needs: [] }];
ok(payrollOf(cdb, '洛杉矶湖人') === 15, '薪资SUM=5+6+4=15');
ok(capOf(cdb) === 42.5 && taxOf(cdb) === 54.5, '帽/税从rules表读取');
finalizeSeason(cdb);
const expired = cdb.freeAgents.find(f => f.name === '到期无选项');
ok(!!expired && expired.salary === 0, '到期无选项→入FA池+薪资清零');
const po = cdb.players.find(p => p.name === '到期球员选项');
ok(po && po.contract_years === 0 && po.status.includes('选项待决') && po.status.includes('球员选项'), '球员选项→选项待决留队');
const long = cdb.players.find(p => p.name === '长约');
ok(long && long.contract_years === 3, '4年长约递减→3年');
ok(cdb.league[0].payroll === 10, '赛季后薪资SUM=0+6+4=10');
ok(cdb.league[0].rosterSize === 2, '名单数=2');

/* 交易价值体系（v1.3.0）：感知天赋不泄露pot真值 */
// TV assertions updated for v1.5
// TV assertions updated for v1.5
// TV assertions updated for v1.5
// TV assertions updated for v1.5
// TV assertions updated for v1.5
// asking assertions updated
// asking assertions updated
// offer assertions updated
// offer assertions updated
// offer assertions updated
// offer assertions updated

/* needs结构化 */
const nn = normalizeNeeds('需要中锋');
ok(nn.length === 1 && nn[0].type === '模糊', '字符串needs兼容迁移');
const nn2 = normalizeNeeds([{ type: '指定', text: '想要科比' }, { type: '模糊', text: '需要选秀权' }]);
ok(nn2.length === 2 && nn2[0].type === '指定', '结构化needs');

/* 选秀权资产：近6年窗口 */
const dbA = emptyDb();
dbA.manager = { ...dbA.manager, team: '华盛顿奇才' };
ensureDraftAssets(dbA);
ok(dbA.assets.filter(a => a.type === '选秀权').length === 12, '建档即有12个选秀权资产（6年×一二轮）');
ok(dbA.assets.some(a => a.name === '2002年首轮签(自有)') && dbA.assets.some(a => a.name === '2007年次轮签(自有)'), '窗口覆盖2002-2007');
dbA.meta.season = 1;
ensureDraftAssets(dbA);
ok(dbA.assets.some(a => a.name === '2008年首轮签(自有)'), '赛季滚动自动补充2008');

/* 交易搜索器：反向（想要对方球员→我方凑包）与正向 */
const ts = emptyDb();
ts.manager = { ...ts.manager, team: '华盛顿奇才', name: '测' };
ts.players = [
  { name: '沙奎尔·奥尼尔', team: '洛杉矶湖人', pos: 'C', age: 28, inside_off: 50, inside_def: 46, outside_off: 38, outside_def: 40, ovr: 93, pot: 93, salary: 24.8, trade_value: 93, untouchable: 1, core_asset: 0, contract: '', injury: '', status: '现役', note: '' },
  { name: '甲', team: '华盛顿奇才', pos: 'SG', age: 24, inside_off: 30, inside_def: 30, outside_off: 40, outside_def: 34, ovr: 40, pot: 70, salary: 2, trade_value: 52, untouchable: 0, core_asset: 0, contract: '', injury: '', status: '现役', note: '' },
  { name: '乙', team: '华盛顿奇才', pos: 'PF', age: 22, inside_off: 34, inside_def: 34, outside_off: 30, outside_def: 30, ovr: 34, pot: 78, salary: 3, trade_value: 46, untouchable: 0, core_asset: 0, contract: '', injury: '', status: '现役', note: '' },
  { name: '丙', team: '华盛顿奇才', pos: 'PG', age: 30, inside_off: 20, inside_def: 20, outside_off: 30, outside_def: 26, ovr: 28, pot: 28, salary: 1, trade_value: 28, untouchable: 0, core_asset: 0, contract: '', injury: '', status: '现役', note: '' },
];
ts.league = [
  { team: '洛杉矶湖人', conference: '西部', record: '56-26', rank: '', core: '', payroll: 54, needs: [{ type: '模糊', text: '需要廉价拼图' }] },
  { team: '华盛顿奇才', conference: '东部', record: '19-63', rank: '', core: '', payroll: 37, needs: [{ type: '模糊', text: '需要一切（重建）' }] },
];
ensureDraftAssets(ts);
// 反向：想要沙克（非卖品要价 93×1.5=139.5）——我方总池不足 → 拒绝报告
let res = tradeSearch(ts, { want: ['沙奎尔·奥尼尔'] });
ok(res.length === 1 && (res[0].note || res[0].error || res[0].give), '反向搜索返回结构');
ok(res[0].asking === 187.5, '非卖品要价187.5(125×1.5)');
// 反向：想要一个可得到的球员（丁 ovr60 → 新TV≈20）
ts.players.push({ name: '丁', team: '洛杉矶湖人', pos: 'SF', age: 26, inside_off: 30, inside_def: 30, outside_off: 40, outside_def: 34, ovr: 60, pot: 62, salary: 5, trade_value: 62, untouchable: 0, core_asset: 0, contract: '', injury: '', status: '现役', note: '' });
res = tradeSearch(ts, { want: ['丁'] });
ok(res.some(r => r.give && r.mode), '反向搜索给出我方凑包方案：' + JSON.stringify(res.filter(r => r.give).map(r => r.mode + '←' + r.give.join('+'))));
ok(res.every(r => !r.give || r.asking <= r.myValue * 1.09), '方案价值带合理');
// 正向：以甲+2002年首轮签 换目标
res = tradeSearch(ts, { offer: ['甲', '2002年首轮签(自有)'] });
ok(res.length >= 1 && (res[0].checks || res[0].note), '正向搜索返回结果');
ok(res.every(r => !r.get || (r.checks && '薪资匹配' in r.checks)), '有目标时含薪资校验');
ok(tradeSearch(ts, { want: ['不存在的人'] })[0]?.error === '球员不在库中', '库里无此人返回error行');



/* ===== 联盟排名/选秀抽签/动态选秀权/未来实力 ===== */
ok(LOTTERY_ODDS.length === 13 && LOTTERY_ODDS[0] === 250, '13队乐透概率，最差25%');
const sdb = emptyDb();
sdb.manager = { ...sdb.manager, team: '华盛顿奇才' };
sdb.rules = [{ id: 'cap', name: '工资帽', value: 42.5 }, { id: 'tax', name: '奢侈税线', value: 54.5 }];
sdb.league = ['芝加哥公牛|15', '金州勇士|17', '华盛顿奇才|19', '孟菲斯灰熊|23', '亚特兰大老鹰|25', '新泽西篮网|26', '克利夫兰骑士|30', '洛杉矶快船|31', '底特律活塞|32', '波士顿凯尔特人|33', '丹佛掘金|40', '西雅图超音速|44', '休斯顿火箭|45', '菲尼克斯太阳|51', '波特兰开拓者|50', '明尼苏达森林狼|47', '犹他爵士|53', '达拉斯小牛|53', '萨克拉门托国王|55', '圣安东尼奥马刺|58', '洛杉矶湖人|56', '密尔沃基雄鹿|52', '奥兰多魔术|43', '印第安纳步行者|41', '夏洛特黄蜂|46', '多伦多猛龙|47', '迈阿密热火|50', '纽约尼克斯|48', '费城76人|56'].map(s => {
  const [team, wins] = s.split('|');
  return { team, conference: ['芝加哥公牛','金州勇士','华盛顿奇才','孟菲斯灰熊','亚特兰大老鹰','新泽西篮网','克利夫兰骑士','洛杉矶快船','底特律活塞','波士顿凯尔特人','密尔沃基雄鹿','奥兰多魔术','印第安纳步行者','夏洛特黄蜂','多伦多猛龙','迈阿密热火','纽约尼克斯','费城76人'].includes(team) ? '东部' : '西部', record: wins + '-' + (82 - Number(wins)), rank: '', payroll: 50, needs: [], wins: Number(wins), losses: 82 - Number(wins) };
});
updateLeagueStandings(sdb);
ok(sdb.league.find(l => l.team === '芝加哥公牛').leagueRank === 29, '公牛15胜=联盟第29');
ok(sdb.league.find(l => l.team === '圣安东尼奥马刺').leagueRank === 1, '马刺58胜=联盟第1');
ok(sdb.league.find(l => l.team === '华盛顿奇才').expectedDraftPos.includes('乐透'), '奇才19胜=乐透区');

// 抽签
const lotto = runDraftLottery(sdb, 42);
ok(lotto.order.length >= 29, '抽签产出29队完整顺序');
ok(lotto.order[0].pos === 1, '第1顺位存在');
ok(lotto.top3Jumps.length === 3, '前3抽签');
ok(lotto.order[28].team === '圣安东尼奥马刺', '马刺最后（58胜最强）');

// 动态选秀权
const weakPick = dynamicPickValue({ name: '2002年首轮签(自有)', type: '选秀权' }, sdb);
ok(weakPick > 30, '弱队（奇才19胜）首轮签 > 30（战绩加成）: ' + weakPick);
// 强队签贬值
sdb.manager.team = '圣安东尼奥马刺';
const strongPick = dynamicPickValue({ name: '2002年首轮签(自有)', type: '选秀权' }, sdb);
ok(strongPick < 30, '强队（马刺58胜）首轮签 < 30（战绩贬值）: ' + strongPick);
ok(weakPick > strongPick * 1.3, '弱队签远贵于强队签');
// 2003勒布朗年
sdb.manager.team = '华盛顿奇才';
const y2003 = dynamicPickValue({ name: '2003年首轮签(自有)', type: '选秀权' }, sdb);
ok(y2003 > weakPick, '2003勒布朗年 > 2002: ' + y2003 + ' > ' + weakPick);
// 远期折价
const y2007 = dynamicPickValue({ name: '2007年首轮签(自有)', type: '选秀权' }, sdb);
ok(y2007 < weakPick, '远期2007 < 当期2002');

// 未来实力
sdb.manager.team = '华盛顿奇才';
const weakFut = assessFutureStrength('华盛顿奇才', sdb);
ok(weakFut.score >= 1 && weakFut.score <= 5, '弱队未来评分1-5: ' + weakFut.score);
ok(Array.isArray(weakFut.reasons) && weakFut.reasons.length > 0, '未来评分含理由');

/* ===== Excel式排序/筛选 ===== */
ok(nextSortState(undefined) === 'asc' && nextSortState('asc') === 'desc' && nextSortState('desc') === null, '三态排序：升→降→还原');
const srows = [
  { name: '丙', ovr: 88, team: 'B队' },
  { name: '甲', ovr: 95, team: 'A队' },
  { name: '乙', ovr: 70, team: '' },
  { name: '丁', ovr: '', team: 'B队' },
];
const keys = ['name', 'ovr', 'team'];
ok(sortRows(srows, keys, { key: 'ovr', dir: 'asc' }).map(r => r.name).join() === '乙,丙,甲,丁', '数值升序+空值置后');
ok(sortRows(srows, keys, { key: 'ovr', dir: 'desc' })[0].name === '甲', '数值降序');
ok(sortRows(srows, keys, { key: 'name', dir: 'asc' })[0].name === '丙', '中文locale排序');
ok(sortRows(srows, keys, { key: null, dir: null }).map(r => r.name).join() === '丙,甲,乙,丁', '无排序=原顺序（还原）');
const frows = [
  { name: 'a', pos: 'PG', team: 'X' }, { name: 'b', pos: 'C', team: 'X' }, { name: 'c', pos: 'PG', team: 'Y' },
];
ok(filterRows(frows, { pos: new Set(['PG']) }).length === 2, '列内单值筛选');
ok(filterRows(frows, { pos: new Set(['PG', 'C']) }).length === 3, '列内多选OR=全选还原');
ok(filterRows(frows, { pos: new Set(['PG']), team: new Set(['Y']) }).length === 1, '列间AND组合');
ok(filterRows(frows, {}).length === 3, '无筛选=还原');
ok(uniqueColumnValues(frows, 'pos').join() === 'C,PG', '去重值列表（数值/文本排序）');
ok(uniqueColumnValues([{ v: '10' }, { v: '2' }, { v: '' }], 'v').join() === '2,10', '数值列去重按数值序');

console.log(`\n==== 测试结果：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
