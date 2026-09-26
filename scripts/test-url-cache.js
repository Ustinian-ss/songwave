// 声浪 SongWave · 播放地址缓存 + 极简 SQLite 读取测试（离线）
// 用法：node scripts/test-url-cache.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUrlCache, parsePlayUrlTable } = require('../src/url-cache');
const { readTable } = require('../src/sqlite-lite');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  try {
    const tmp = path.join(os.tmpdir(), 'songwave-urlcache-' + Date.now() + '.json');
    const cache = createUrlCache(tmp);

    // —— 读写与音源别名（本应用 kuwo ↔ 其它播放器 kw）——
    cache.set('kuwo', '239211505', 'http://cdn/x.mp3', { quality: '128k', from: 'lx' });
    check('写入后能读回', !!cache.get('kuwo', '239211505', '128k'));
    check('别名互通：kuwo 写入、kw 读出（关键，否则导入的缓存用不上）',
      !!cache.get('kw', '239211505', '128k'));
    check('音质不同也能命中（先保证能播）', !!cache.get('kuwo', '239211505', '320k'));
    check('不存在的歌返回 null', cache.get('kuwo', '999', '128k') === null);

    const added = cache.importPairs([
      { key: 'kw:100:128k', url: 'http://cdn/a.mp3', from: 'lx' },
      { key: 'kw:100:128k', url: 'http://cdn/a.mp3', from: 'lx' },   // 重复
      { key: 'wy:200:128k', url: 'http://cdn/b.mp3', from: 'lx' },
      { key: 'bad', url: '' },
    ]);
    check('批量导入去重', added === 2, String(added));
    check('导入的 kw 记录能被本应用的 kuwo 命中', !!cache.get('kuwo', '100', '128k'));
    check('导入的 wy 记录能被本应用的 netease 命中', !!cache.get('netease', '200', '128k'));
    const st = cache.stats();
    check('统计总数正确', st.total === 3, JSON.stringify(st.bySource));
    check('统计按来源分组', st.bySource.kw === 2 && st.bySource.wy === 1);
    cache.remove('kuwo', '239211505', '128k');
    check('删除生效', cache.get('kuwo', '239211505', '128k') === null);
    check('缓存文件已落盘', fs.existsSync(tmp));
    fs.unlinkSync(tmp);

    // —— 降级扫描：DB 里 id 与 url 相邻时的解析 ——
    const raw = Buffer.from('xxx kw_239211505_128khttp://car-er.kuwo.cn/a/b/M5000044Fd2s1LB6MJ.mp3 yyy wy_3383077624_128khttp://m701.music.126.net/x/y.mp3 zzz', 'latin1');
    const rows = parsePlayUrlTable(raw);
    check('扫描能提取 kw 记录', rows.some((r) => r.key === 'kw:239211505:128k'), JSON.stringify(rows));
    check('扫描能提取 wy 记录', rows.some((r) => r.key === 'wy:3383077624:128k'));
    check('扫描结果 url 完整', (rows[0] || {}).url === 'http://car-er.kuwo.cn/a/b/M5000044Fd2s1LB6MJ.mp3', (rows[0] || {}).url);

    // —— SQLite 读取器：坏文件不炸 ——
    const badFile = path.join(os.tmpdir(), 'songwave-bad-' + Date.now() + '.db');
    fs.writeFileSync(badFile, Buffer.from('not a database at all'));
    let threw = false;
    try { readTable(badFile, 'music_url'); } catch (e) { threw = true; }
    check('非数据库文件不抛异常（返回空）', !threw);
    fs.unlinkSync(badFile);

    // —— 接线断言 ——
    const mainSrc = read('electron/main.js');
    check('主进程：取链前先查缓存', mainSrc.indexOf('已解析地址缓存') >= 0 && mainSrc.indexOf('getUrlCache().get(') >= 0);
    check('主进程：缓存地址先验证再播', /const probe = await probeAudio\(hit\.url/.test(mainSrc));
    check('主进程：失效缓存会被剔除', mainSrc.indexOf('getUrlCache().remove(') >= 0);
    check('主进程：取链成功写回缓存', mainSrc.indexOf('getUrlCache().set(payload.source') >= 0);
    check('主进程：有从其它播放器导入的入口', mainSrc.indexOf("songwave-cache-import-others") >= 0 && mainSrc.indexOf('readTable(') >= 0);
    check('主进程：导入用极简 SQLite（无第三方依赖）', mainSrc.indexOf("require('../src/sqlite-lite')") >= 0);
    const preload = read('electron/preload.js');
    check('preload 暴露导入接口', preload.indexOf('cacheImportOthers') >= 0);
    const renderer = read('app/renderer.js');
    check('界面有导入按钮逻辑', renderer.indexOf('importUrlCache') >= 0 && renderer.indexOf('已导入') >= 0);
    check('界面按钮已接线', renderer.indexOf("$('cache-import')") >= 0);
    const html = read('app/index.html');
    check('面板有导入按钮', html.indexOf('id="cache-import"') >= 0);
    // 关键：缓存必须在扩展音源之前命中（否则源后端挂了又要先等一轮失败）
    const cachePos = mainSrc.indexOf('getUrlCache().get(payload.source');
    const extPos = mainSrc.indexOf("resolveViaExtSources(payload.extKey, 'musicUrl'");
    check('缓存优先于音源脚本（顺序正确）', cachePos > 0 && extPos > cachePos, cachePos + ' vs ' + extPos);
  } catch (e) {
    console.error('测试运行异常:', e);
    fail++;
  }
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
