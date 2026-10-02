// NBADB 集成测试 v1.1.0：四步→导入→建档→回写自测+自动开局→注入→结算→提取兜底→联盟→镜像外置恢复→停用开关
import { readFileSync } from 'node:fs';

const handlers = new Map();
const eventSource = {
  on(type, h) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(h); },
  off(type, h) { const a = handlers.get(type); if (a) handlers.set(type, a.filter(x => x !== h)); },
  emit(type, ...args) { for (const h of [...(handlers.get(type) || [])]) h(...args); },
};
const ET = { APP_READY: 'app_ready', MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped', MESSAGE_DELETED: 'message_deleted', CHAT_CHANGED: 'chat_changed', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' };
const chat = [];
const sentCmds = [];
const theCtx = {
  chat, chatId: 'inttest-chat-1', chatMetadata: {}, characters: [{ avatar: 'card.png', chat: 'chatfile' }], characterId: 0,
  eventSource, event_types: ET, extensionSettings: {},
  saveMetadata: async () => { }, saveChat: async () => { }, addOneMessage: () => { },
  executeSlashCommands: async (cmd) => { sentCmds.push(cmd); return ''; },
  generateQuietPrompt: async ({ quietPrompt }) => {
    const marker = quietPrompt.slice(0, quietPrompt.indexOf('\n'));
    const patch = { players: [{ name: '理查德·汉密尔顿', ovr: 76, note: '提取兜底涨球' }] };
    return marker + '\n' + JSON.stringify(patch);
  },
};
globalThis.SillyTavern = { getContext: () => theCtx, libs: {} };
globalThis.toastr = { success: () => { }, error: () => { }, warning: () => { }, info: () => { } };
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
  get length() { return memStore.size; },
  key: (i) => [...memStore.keys()][i],
};

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

const mod = await import('../index.js');
await mod.onActivate();
eventSource.emit(ET.APP_READY);
await new Promise(r => setTimeout(r, 150));
ok(globalThis.NBADB, 'API已发布');

/* ①② 连接握手 */
const code = await NBADB.issue();
chat.push({ is_user: true, mes: 'NBADB验证 ' + code, send_date: 1, extra: {} });
eventSource.emit(ET.MESSAGE_SENT, chat.length - 1);
await new Promise(r => setTimeout(r, 100));
const verifyMsg = chat.filter(m => m.extra?.nbadb_control).at(-1);
const verification = verifyMsg.mes.match(/验证代码：([a-f0-9]{64})/)[1];
await NBADB.connect(verification);
ok(true, '双向验证连接');

/* ③ 导入+建档 */
await NBADB.importJson(readFileSync(new URL('../data/league_2001.json', import.meta.url), 'utf8'), 'league_2001.json');
await NBADB.importJson(readFileSync(new URL('../data/prospects_pool.json', import.meta.url), 'utf8'), 'prospects_pool.json');
await NBADB.createManager({ name: '林一', team: '华盛顿奇才', background: '数据分析师', style: '' });
ok((await NBADB.db()).players.length >= 380, '导入380+人');
{
  const dbM = await NBADB.db();
  ok(dbM.assets.filter(a => a.type === '选秀权').length === 12, '建档即12个选秀权资产（2002-2007窗口）');
  ok(dbM.assets.some(a => a.name === '2002年首轮签(自有)') && dbM.assets.some(a => a.name === '2007年次轮签(自有)'), '窗口覆盖2002-2007');
  ok(dbM.assets.some(a => a.type === '现金'), '现金补偿额度在档');
}

/* ④ 开始游戏：回写自测+自动开局 */
sentCmds.length = 0;
await NBADB.start();
let db = await NBADB.db();
ok(db.meta.gameStarted === true, '游戏已开始');
ok(globalThis.NBADB.diagnostics.writeTest2?.startsWith('通过'), '真实回写自测通过：' + globalThis.NBADB.diagnostics.writeTest2);
ok(sentCmds.length === 1 && sentCmds[0].includes('/send') && sentCmds[0].includes('按档案开局'), '自动驱动开局对话（/send 按档案开局）');
ok(!db.events.some(e => e.eventId === '_start_test'), '自测痕迹已还原清除');
// 重复开始：已有剧情回复后不再自动发送
chat.push({ is_user: false, is_system: false, name: 'NBA经理2001', mes: 'AI剧情回复', send_date: 2, extra: {} });
sentCmds.length = 0;
await NBADB.start();
ok(sentCmds.length === 0, '已有剧情回复时不重复发送开局');

/* 注入 */
chat.length = 2; // 清回剧情回复，保留两条控制消息，便于轮次计算
chat.push({ is_user: true, mes: '开始我的总经理生涯', send_date: 3, extra: {} });
let aborted = null;
const promptChat = [...chat];
await globalThis.nbadbInterceptor(promptChat, 4096, (a) => { aborted = a; }, 'normal');
ok(aborted === null && promptChat.at(-1)?.extra?.nbadb_temporary, '快照注入');
ok(promptChat.at(-1).mes.includes('理查德·汉密尔顿') && promptChat.at(-1).mes.includes('d20a'), '注入含名单与骰值');
ok(promptChat.at(-1).mes.includes('交易值'), '注入含交易价值');
ok(promptChat.at(-1).mes.includes('指定:想要科特'), '注入含结构化需求（猛龙指定需求）');
ok(promptChat.at(-1).mes.includes('剩'), '注入含合同年限');
ok(promptChat.at(-1).mes.includes('工资帽'), '注入含规则库');
db = await NBADB.db();
const d20a = db.dice.rolls.d20a;
ok(db.dice.turn === 1, '骰子轮次=1');

/* 标签结算 turn=1 */
const revision = (await NBADB.db()).meta.revision;
const aiText = `①计数器……\n④判定：🎲1d20=${d20a} vs DC12 成功。\n⑥进行中项目：汉密尔顿·潜力兑现（15%）。\n本轮结算快照（待结算）\n<nbadb-settlement>{"turn":1,"baseRevision":${revision},"patch":{"players":[{"name":"理查德·汉密尔顿","ovr":75}],"programs":[{"name":"汉密尔顿·潜力兑现","player":"理查德·汉密尔顿","kind":"潜力兑现","progress":"15%"}],"events":[{"eventId":"t1-train","turn":1,"title":"启动夏训","detail":"x"}]}}</nbadb-settlement>`;
chat.push({ is_user: false, is_system: false, name: 'NBA经理2001', mes: aiText, send_date: 4, extra: {}, swipes: [aiText], swipe_id: 0 });
const aiIndex = chat.length - 1;
await NBADB.writeback(aiIndex);
db = await NBADB.db();
ok(db.players.find(p => p.name === '理查德·汉密尔顿').ovr === 75, '标签结算ovr=75');
ok(!chat[aiIndex].mes.includes('nbadb-settlement'), '标签剥离');
ok(chat[aiIndex].extra?.nbadb_receipt?.type === 'settlement', '回执settlement');

/* 提取兜底 turn=2（无标签消息→隐藏提取） */
chat.push({ is_user: true, mes: '自由训练一周', send_date: 5, extra: {} });
chat.push({ is_user: false, is_system: false, name: 'NBA经理2001', mes: '①……⑥汉密尔顿训练中。', send_date: 6, extra: {}, swipes: [], swipe_id: 0 });
const extIdx = chat.length - 1;
await NBADB.writeback(extIdx);
db = await NBADB.db();
ok(db.players.find(p => p.name === '理查德·汉密尔顿').ovr === 76, '提取兜底：ovr=76');
ok(chat[extIdx].extra?.nbadb_receipt?.type === 'extract', '回执extract');
ok(globalThis.NBADB.diagnostics.extraction.includes('提取到集合'), '提取诊断');

/* 空写入 turn=3 */
chat.push({ is_user: true, mes: '推进时间', send_date: 7, extra: {} });
const rev2 = (await NBADB.db()).meta.revision;
chat.push({ is_user: false, is_system: false, name: 'NBA经理2001', mes: '……\n本轮结算快照（待结算）\n<nbadb-settlement>{"turn":3,"baseRevision":' + rev2 + ',"patch":{}}</nbadb-settlement>', send_date: 8, extra: {}, swipes: [], swipe_id: 0 });
const emptyIdx = chat.length - 1;
await NBADB.writeback(emptyIdx);
ok(chat[emptyIdx].extra?.nbadb_receipt?.type === 'no_change', '空写入=合法no_change');

/* 联盟结算 turn=4 */
chat.push({ is_user: true, mes: '进入赛季结算', send_date: 9, extra: {} });
const others = ['费城76人','密尔沃基雄鹿','迈阿密热火','纽约尼克斯','多伦多猛龙','夏洛特黄蜂','奥兰多魔术','印第安纳步行者','底特律活塞','波士顿凯尔特人','克利夫兰骑士','新泽西篮网','亚特兰大老鹰','芝加哥公牛','圣安东尼奥马刺','萨克拉门托国王','犹他爵士','达拉斯小牛','菲尼克斯太阳','波特兰开拓者','明尼苏达森林狼','休斯顿火箭','西雅图超音速','丹佛掘金','洛杉矶快船','孟菲斯灰熊','金州勇士','洛杉矶湖人'];
const leaguePayload = [{ team: '华盛顿奇才', record: '33-49', rank: '东部12', playoffs: '未进', in: ['托尼·帕克'], out: [], core: [{ name: '托尼·帕克', ovr: 71 }], payroll: 39, note: '重建起步' }].concat(others.map(tm => ({ team: tm, record: '50-32', note: '' })));
chat.push({ is_user: false, is_system: false, name: 'NBA经理2001', mes: '总决赛落幕。\n<nbadb-league>' + JSON.stringify(leaguePayload) + '</nbadb-league>', send_date: 10, extra: {}, swipes: [], swipe_id: 0 });
await NBADB.writeback(chat.length - 1);
db = await NBADB.db();
ok(db.meta.season === 1 && db.players.find(p => p.name === '托尼·帕克')?.ovr === 71, '联盟结算+跨年');
ok(db.assets.some(a => a.name === '2008年首轮签(自有)') && db.assets.some(a => a.name === '2008年次轮签(自有)'), '赛季滚动自动补充2008年一二轮签');

/* 交易搜索器API冒烟 */
const tsWant = await NBADB.tradeSearch({ want: ['克里斯·韦伯'] });
ok(Array.isArray(tsWant) && tsWant[0]?.asking > 90, '反向搜索：韦伯要价>90（重要资产溢价）: ' + (tsWant[0]?.asking ?? '?'));
const tsGive = await NBADB.tradeSearch({ want: ['贾森·特里'] });
ok(tsGive.some(r => r.give && r.mode), '反向凑包方案：' + JSON.stringify(tsGive.filter(r => r.give).slice(0, 2).map(r => r.mode + '←' + r.give.join('+') + '(要价' + r.asking + ')')));
ok(tsGive.every(r => !r.give || (r.checks && '薪资匹配' in r.checks && 'Stepien规则' in r.checks)), '方案含NBA规则校验');
const tsFwd = await NBADB.tradeSearch({ offer: ['理查德·汉密尔顿', '2002年首轮签(自有)'] });
ok(Array.isArray(tsFwd) && tsFwd.length >= 1 && (tsFwd[0].checks || tsFwd[0].note), '正向搜索返回目标或说明: ' + (tsFwd[0]?.get || tsFwd[0]?.note || '?'));

/* 镜像外置恢复（模拟浏览器IndexedDB丢失） */
await NBADB.mirror();
const archKey = encodeURIComponent(JSON.stringify(['character', 'card.png', 'chatfile']));
const arch = theCtx.extensionSettings.NBADB.archives[archKey];
ok(!!arch && arch.revision === (await NBADB.db()).meta.revision, '镜像已写入服务器设置（revision ' + (arch?.revision ?? '无') + '）');
for (const k of [...memStore.keys()]) if (k.startsWith('nbadb.')) memStore.delete(k);
eventSource.emit(ET.CHAT_CHANGED);
await new Promise(r => setTimeout(r, 250));
db = await NBADB.db();
ok(db.players.length >= 250 && db.manager.team === '华盛顿奇才' && db.meta.season === 1, '浏览器存储丢失→从服务器镜像完整恢复（335人+档案+赛季1）');
ok(db.players.find(p => p.name === '托尼·帕克').team === '华盛顿奇才', '恢复后含赛季结算结果');

/* 停用开关 */
theCtx.extensionSettings.NBADB.enabled = false;
chat.push({ is_user: true, mes: '测试停用', send_date: 11, extra: {} });
const beforeLen = chat.length;
await globalThis.nbadbInterceptor(chat, 0, () => { }, 'normal');
ok(chat.length === beforeLen, '停用后拦截器不注入不拦截');
theCtx.extensionSettings.NBADB.enabled = true;

/* ===== 继续游戏·第二次聊天重连 ===== */
// 切换到同角色新聊天文件（模拟"聊天太长开新档继续"）
theCtx.chatId = 'inttest-chat-2';
theCtx.characters[0].chat = 'chatfile2';
theCtx.chatMetadata = {};
chat.length = 0;
chat.push({ is_user: true, mes: '新档继续', send_date: 11, extra: {} });
eventSource.emit(ET.CHAT_CHANGED);
await new Promise(r => setTimeout(r, 200));
db = await NBADB.db();
ok(db.players.length === 0, '新聊天=空库（独立存档）');
const cands = await NBADB.candidates();
ok(cands.length >= 1 && cands[0].team === '华盛顿奇才', '发现同角色历史存档候选（' + (cands[0]?.team || '无') + '·赛季' + (cands[0]?.season ?? '?') + '·源' + (cands[0]?.source ?? '?') + '）');
let aborted3 = null;
await globalThis.nbadbInterceptor([...chat], 0, (a) => { aborted3 = a; }, 'normal');
ok(aborted3 === true, '未重连的新聊天仍被拦截');
ok(String(NBADB.diagnostics.injection).includes('继续游戏·重连') || String(NBADB.diagnostics.injection).includes('第二步'), '拦截提示含重连指引：' + NBADB.diagnostics.injection.slice(0, 40));
// 一键重连
sentCmds.length = 0;
await NBADB.reconnect();
db = await NBADB.db();
ok(db.players.length >= 250 && db.manager.team === '华盛顿奇才' && db.meta.season === 1, '重连成功：完整存档迁移到新聊天（335人+档案+赛季1）');
ok(db.meta.gameStarted === true && db.connection?.status === 'connected', '重连后已连接且游戏进行中（③④自动满足）');
ok(sentCmds.length === 1 && sentCmds[0].includes('已重连存档'), '自动发送继续游戏指令：' + sentCmds[0].slice(0, 30) + '…');
let aborted4 = null;
const pc2 = [...chat];
await globalThis.nbadbInterceptor(pc2, 0, (a) => { aborted4 = a; }, 'normal');
ok(aborted4 === null && pc2.at(-1)?.extra?.nbadb_temporary, '重连后立即恢复注入（无需重复四步）');
// 重复重连被拒
try { await NBADB.reconnect(); ok(false, '已绑定聊天重复重连应被拒'); } catch { ok(true, '已绑定聊天重复重连被拒'); }

/* 第三个新聊天：无提示下的常规拦截路径（无session指针的场景由镜像候选覆盖） */
theCtx.chatId = 'inttest-chat-3';
theCtx.characters[0].chat = 'chatfile3';
theCtx.chatMetadata = {};
chat.length = 0;
chat.push({ is_user: true, mes: '全新开始', send_date: 12, extra: {} });
let aborted2 = null;
await globalThis.nbadbInterceptor([{ is_user: true, mes: '新档', send_date: 12, extra: {} }], 0, (a) => { aborted2 = a; }, 'normal');
ok(aborted2 === true, '未绑定的全新聊天仍被拦截（可选重连或开新档）');

console.log(`\n==== 集成测试：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
