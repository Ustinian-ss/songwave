// 声浪 SongWave · 音源候选排序 + 脚本元信息测试（离线）
// 用法：node scripts/test-source-pick.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { orderCandidates, markHealth, DEFAULT_COOLDOWN } = require('../src/sources/pick-source');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  try {
    // —— 排序：最近成功的优先，冷却期内失败的排最后，没试过的居中 ——
    const now = 1_000_000_000;
    const health = new Map([
      ['good', { okAt: now - 1000 }],
      ['bad', { failAt: now - 1000 }],
      ['stale', { failAt: now - DEFAULT_COOLDOWN - 1 }],   // 冷却期已过，不算坏
    ]);
    const cands = [{ id: 'never' }, { id: 'bad' }, { id: 'good' }, { id: 'stale' }];
    const ordered = orderCandidates(cands, health, { now: now }).map((c) => c.id);
    check('最近成功的排最前', ordered[0] === 'good', ordered.join(','));
    check('冷却期内失败的排最后', ordered[ordered.length - 1] === 'bad', ordered.join(','));
    check('没试过的排在成功者之后', ordered.indexOf('never') === 1, ordered.join(','));
    check('冷却期已过的失败不算坏', ordered.indexOf('stale') < ordered.indexOf('bad'), ordered.join(','));
    check('不丢候选（数量不变）', ordered.length === 4, String(ordered.length));
    check('不改动入参数组', cands[0].id === 'never' && cands.length === 4);

    // —— 失败后又被标记成功：应以成功为准，不再排最后 ——
    const h2 = new Map([['a', { failAt: now - 1000 }]]);
    markHealth(h2, 'a', true, '', now);
    check('成功会清掉失败标记', h2.get('a').fails === 0 && h2.get('a').reason === '');
    const o2 = orderCandidates([{ id: 'a' }, { id: 'b' }], h2, { now: now }).map((c) => c.id);
    check('成功过的重新排最前', o2[0] === 'a', o2.join(','));

    // —— 失败记录原因，便于界面/日志展示 ——
    const h3 = new Map();
    markHealth(h3, 'x', false, 'fetch failed ← getaddrinfo ENOTFOUND flower.tempmusics.tk', now);
    check('失败记录原因', h3.get('x').reason.indexOf('ENOTFOUND') >= 0);
    check('失败累计次数', markHealth(h3, 'x', false, 'again', now).fails === 2);
    check('失败原因超长会截断', markHealth(h3, 'y', false, 'x'.repeat(500), now).reason.length <= 160);

    // —— 空输入不炸 ——
    check('空候选返回空数组', orderCandidates([], new Map()).length === 0);
    check('无健康度表也能排序', orderCandidates([{ id: 'a' }], null).length === 1);

    // —— 脚本头部元信息：@version 必须传进沙箱（flower 用它做 source-ver 校验）——
    const tmp = path.join(os.tmpdir(), 'songwave-pick-fixture-' + Date.now() + '.js');
    fs.writeFileSync(tmp, [
      '/**',
      ' * @name 测试音源🌷',
      ' * @version 1',
      ' * @description 头部元信息测试',
      ' * @author tester',
      ' * @homepage https://example.com/x',
      ' */',
      'globalThis.lx.send(lx.EVENT_NAMES.inited, {',
      '  status: true,',
      '  sources: { kw: { name: "酷我", type: "music", actions: ["musicUrl"], qualitys: ["128k"] } },',
      '  info: {',
      '    name: lx.currentScriptInfo.name,',
      '    version: lx.currentScriptInfo.version,',
      '    author: lx.currentScriptInfo.author,',
      '    homepage: lx.currentScriptInfo.homepage,',
      '    rawLen: String(lx.currentScriptInfo.rawScript || "").length,',
      '  },',
      '});',
    ].join('\n'), 'utf8');
    const { loadScript } = require('../src/sources/script-runtime');
    const r = await loadScript(tmp, { initTimeoutMs: 4000 });
    const info = r.runtime.getInited().info;
    check('从脚本头读到 @name', info.name === '测试音源🌷', info.name);
    check('从脚本头读到 @version（关键）', info.version === '1', info.version);
    check('从脚本头读到 @author', info.author === 'tester', info.author);
    check('从脚本头读到 @homepage', info.homepage === 'https://example.com/x', info.homepage);
    check('rawScript 已提供', Number(info.rawLen) > 100, info.rawLen);
    check('声明源被正确解析', !!r.sources.kw && r.sources.kw.actions.indexOf('musicUrl') >= 0);
    fs.unlinkSync(tmp);

    // —— 外部传入的版本不该覆盖脚本自己声明的版本 ——
    const tmp2 = path.join(os.tmpdir(), 'songwave-pick-fixture2-' + Date.now() + '.js');
    fs.writeFileSync(tmp2, [
      '/** @name 无版本脚本 */',
      'globalThis.lx.send(lx.EVENT_NAMES.inited, { status: true, sources: { kw: { name: "酷我", actions: ["musicUrl"] } }, info: { version: lx.currentScriptInfo.version } });',
    ].join('\n'), 'utf8');
    const r2 = await loadScript(tmp2, { initTimeoutMs: 4000, version: '9.9.9' });
    check('脚本未声明版本时回退到登记表版本', r2.runtime.getInited().info.version === '9.9.9', r2.runtime.getInited().info.version);
    fs.unlinkSync(tmp2);

    // —— 接线断言：主进程必须"多音源依次尝试"，不能只取第一个 ——
    const mainSrc = read('electron/main.js');
    check('主进程有 resolveViaExtSources（逐个候选）', mainSrc.indexOf('async function resolveViaExtSources') >= 0);
    check('候选经过健康度排序', mainSrc.indexOf('orderCandidates(cands, srcHealth)') >= 0);
    check('每个音源尝试都有独立超时', mainSrc.indexOf('SRC_TRY_TIMEOUT') >= 0 && mainSrc.indexOf('withTimeout(') >= 0);
    check('取链失败会记健康度', mainSrc.indexOf('markHealth(srcHealth') >= 0);
    check('取链结果带上是哪个音源（便于排查）', mainSrc.indexOf("via: 'ext:' + payload.extKey + ' @ ' + ext.via") >= 0);
    check('歌词也走多音源', mainSrc.indexOf("resolveViaExtSources(payload.extKey, 'lyric'") >= 0);
  } catch (e) {
    console.error('测试运行异常:', e);
    fail++;
  }
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
