// 声浪 SongWave · 音源脚本管理测试（离线：假 lx 脚本 + mock fetch）
// 用法：node scripts/test-source-manager.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSourceManager, looksLikeLxScript, safeName } = require('../src/sources/source-manager');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

// 一个最小的合法 lx v2 音源脚本（声明 kw/tx 取链能力 + 注册 request 处理器）
const FAKE_LX = `
const { EVENT_NAMES, on, send } = globalThis.lx;
send(EVENT_NAMES.inited, {
  sources: {
    kw: { name: '酷我', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] },
    tx: { name: 'QQ', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] }
  }
});
on(EVENT_NAMES.request, ({ source, action, info }) => {
  if (action === 'musicUrl') return Promise.resolve({ url: 'http://mock/' + source + '/' + info.musicInfo.id + '.mp3' });
  return Promise.reject(new Error('不支持的动作: ' + action));
});
`;
const BROKEN_LX = `const { EVENT_NAMES, on, send } = globalThis.lx; send(EVENT_NAMES.inited, { sources: {} });`;
const NOT_LX = `<html><body>hello world, this is not a script at all</body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songwave-srcmgr-'));
const srcDir = path.join(tmp, 'scripts');
let fetchCalls = [];

function makeFetch(map) {
  return async (url) => {
    fetchCalls.push(String(url));
    const body = map[String(url)];
    if (body == null) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, status: 200, text: async () => body };
  };
}

(async () => {
  try {
    // 1) 工具函数
    check('识别 lx 脚本', looksLikeLxScript(FAKE_LX) === true);
    check('拒绝非 lx 内容', looksLikeLxScript(NOT_LX) === false);
    check('文件名清理', safeName('flower-v1.0.0.js') === 'flower-v1.0.0' && safeName('a b/c.js') === 'a_b_c', safeName('flower-v1.0.0.js') + ' | ' + safeName('a b/c.js'));

    const mgr = createSourceManager({
      dir: srcDir,
      initTimeoutMs: 8000,
      fetchImpl: makeFetch({ 'https://src.example/flower.js': FAKE_LX, 'https://src.example/bad.js': NOT_LX }),
    });

    check('初始音源列表为空', mgr.list().length === 0);

    // 2) 从链接导入
    const e1 = await mgr.addFromUrl('https://src.example/flower.js');
    check('链接导入成功', e1 && e1.ok === true, JSON.stringify(e1 && e1.error));
    check('探测到 2 个平台', e1.sourceKeys.length === 2, JSON.stringify(e1.sourceKeys));
    check('kw 支持 musicUrl', (e1.actions.kw || []).includes('musicUrl'));
    check('脚本已落盘', fs.existsSync(e1.file));
    check('注册表已持久化', mgr.list().length === 1);
    check('新导入默认启用', e1.enabled === true);

    // 3) 非法链接 / 非脚本内容
    let err1 = null;
    try { await mgr.addFromUrl('file:///c:/x.js'); } catch (e) { err1 = e.message; }
    check('拒绝非 http 链接', /只支持 http\/https/.test(String(err1)), String(err1));
    let err2 = null;
    try { await mgr.addFromUrl('https://src.example/bad.js'); } catch (e) { err2 = e.message; }
    check('拒绝非 lx 脚本内容', /不是有效的 lx 音源脚本/.test(String(err2)), String(err2));
    let err3 = null;
    try { await mgr.addFromUrl('https://src.example/missing.js'); } catch (e) { err3 = e.message; }
    check('下载失败有明确错误', /下载失败/.test(String(err3)), String(err3));

    // 4) 从本地文件导入（含“能力为空”的脚本也要能记录）
    const brokenPath = path.join(tmp, 'broken.js');
    fs.writeFileSync(brokenPath, BROKEN_LX);
    const e2 = await mgr.addFromFile(brokenPath);
    check('本地文件导入成功', !!e2);
    check('空能力脚本被标记 ok=false', e2.ok === false, String(e2.error));
    check('本地导入已持久化', mgr.list().length === 2);

    // 5) 启用/停用、删除
    mgr.toggle(e1.id, false);
    check('停用已生效', mgr.list().find((x) => x.id === e1.id).enabled === false);
    mgr.toggle(e1.id, true);
    check('重新启用已生效', mgr.list().find((x) => x.id === e1.id).enabled === true);

    // 6) loadEnabled 只加载启用的
    mgr.toggle(e2.id, false);
    const loaded = await mgr.loadEnabled();
    check('只加载启用的音源', loaded.length === 1, String(loaded.length));
    check('加载出的适配对象可用', !!(loaded[0].source && loaded[0].source.sourceKeys.length === 2));
    // 真正跑一次取链，验证端到端
    const url = await loaded[0].source.getPlayUrl('kw', { id: 'X1' }, '128k');
    check('端到端取链成功', url === 'http://mock/kw/X1.mp3', String(url));

    check('删除音源', mgr.remove(e2.id) === true && mgr.list().length === 1);
    const removedFile = fs.existsSync(e2.file);
    check('删除时清理脚本文件', removedFile === false);

    // 7) 持久化：新建 manager 能读到旧注册表
    const mgr2 = createSourceManager({ dir: srcDir, fetchImpl: makeFetch({}) });
    check('重启后仍能读到音源', mgr2.list().length === 1 && mgr2.list()[0].name.indexOf('flower') >= 0, JSON.stringify(mgr2.list().map((x) => x.name)));
  } catch (e) {
    console.error('测试运行异常:', e);
    fail++;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();