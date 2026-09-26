// 声浪 SongWave · 从其它播放器导入音源测试（离线 fixture + 真机只读检查）
// 用法：node scripts/test-import-sources.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createSourceManager } = require('../src/sources/source-manager');
const lxImport = require('../src/sources/import-sources');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

const FAKE_SCRIPT = `/**
 * @name 测试音源
 * @version 9.9.9
 */
const { EVENT_NAMES, on, send } = globalThis['lx'];
send(EVENT_NAMES.inited, { sources: { kw: { name: 'kw', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });
on(EVENT_NAMES.request, ({ source, action, info }) => Promise.resolve({ url: 'http://mock/' + source + '/' + info.musicInfo.id }));
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'songwave-lximport-'));

(async () => {
  try {
    // 1) 压缩格式编解码（外部播放器存的是 gz_ + base64(zlib)）
    const compressed = 'gz_' + zlib.deflateSync(Buffer.from(FAKE_SCRIPT, 'utf8')).toString('base64');
    const decoded = lxImport.decodeLxScript(compressed);
    check('能解开外部播放器的 gz_ 压缩脚本', decoded.indexOf('@name 测试音源') >= 0, decoded.slice(0, 40));
    check('未压缩内容原样返回', lxImport.decodeLxScript('abc') === 'abc');
    const meta = lxImport.headerMeta(decoded);
    check('能从脚本头注释读出 @name/@version', meta.name === '测试音源' && meta.version === '9.9.9', JSON.stringify(meta));

    // 2) 读取 fixture 的 user_api.json
    const fixture = path.join(tmp, 'user_api.json');
    fs.writeFileSync(fixture, JSON.stringify({
      userApis: [
        { id: 'u1', name: '列表名（应被脚本头覆盖）', version: '1', author: 'a', homepage: 'h', description: 'd', script: compressed },
        { id: 'u2', name: '坏的', version: '1', script: 'x' },
      ],
    }));
    const list = lxImport.readLxUserApis(fixture);
    check('只保留有效脚本（短文本被过滤）', list.length === 1, String(list.length));
    check('名称/版本以脚本头为准', list[0].name === '测试音源' && list[0].version === '9.9.9', JSON.stringify(list[0].name));
    check('标记为已解压', list[0].compressed === true);

    // 3) 导入到音源管理器并探测能力
    const mgr = createSourceManager({ dir: path.join(tmp, 'sources'), initTimeoutMs: 8000 });
    const r = await lxImport.importFromLxMusic(mgr, { file: fixture });
    check('导入成功 1 个', r.imported.length === 1, JSON.stringify(r.skipped));
    check('能力探测通过（kw 取链）', r.imported[0].ok === true && r.imported[0].sourceKeys.join(',') === 'kw', JSON.stringify(r.imported[0]));
    check('记录了来源 外部播放器', r.imported[0].from === '外部播放器');
    check('记录了版本号（部分脚本用它做版本校验）', r.imported[0].version === '9.9.9');

    // 4) 加载后能真正取链
    const loaded = await mgr.loadEnabled();
    check('加载出 1 个可用音源', loaded.length === 1 && !!loaded[0].source);
    const url = await loaded[0].source.getPlayUrl('kw', { id: 'ABC' });
    check('端到端取链成功', url === 'http://mock/kw/ABC', String(url));

    // 5) 找不到外部播放器数据时的报错
    let err = null;
    try { await lxImport.importFromLxMusic(mgr, { file: path.join(tmp, 'nope.json') }); } catch (e) { err = e.message; }
    check('文件不存在时报错清晰', /no such file|不存在|ENOENT/i.test(String(err)), String(err));
  } catch (e) {
    console.error('测试运行异常:', e);
    fail++;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 6) 真机只读检查（有外部播放器才断言内容）
  console.log('\n— 本机外部播放器音源 —');
  const real = lxImport.findLxUserApiFile();
  if (real) {
    const list = lxImport.readLxUserApis(real);
    console.log('  文件:', real);
    console.log('  音源:', list.map((a) => a.name + ' v' + a.version).join(' | '));
    check('真机读取到音源', list.length >= 1);
    check('真机脚本已解压（不是 gz_ 开头）', list.every((a) => !a.script.startsWith('gz_')));
  } else {
    console.log('  （本机未安装该外部播放器，跳过）');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();