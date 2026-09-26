// 声浪 SongWave · 扩展音源脚本运行时测试（离线，无需网络/Electron）
// 用法：node scripts/test-script-runtime.js [脚本路径]
// 默认读取环境变量 SONGWAVE_SOURCE_SCRIPT 指定的脚本；也可把路径作为第一个参数传入
'use strict';

const path = require('path');
const fs = require('fs');
const { loadScript } = require('../src/sources/script-runtime');
const { createLxSource } = require('../src/sources/script-source');

const DEFAULT_SCRIPT = process.env.SONGWAVE_SOURCE_SCRIPT || '';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

async function main() {
  let scriptPath = process.argv[2] || DEFAULT_SCRIPT;
  let tmpFixture = null;
  // 没有指定脚本时，自动生成一个符合 ABI 的最小示例脚本，保证测试对任何环境都有意义
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    const os = require('os');
    tmpFixture = path.join(os.tmpdir(), 'songwave-runtime-fixture-' + Date.now() + '.js');
    fs.writeFileSync(tmpFixture, [
      "const { EVENT_NAMES, on, send } = globalThis.lx;",
      "send(EVENT_NAMES.inited, { sources: {",
      "  kw: { name: '酷我', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] },",
      "  tx: { name: 'QQ', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] }",
      "} });",
      "on(EVENT_NAMES.request, ({ source, action, info }) => {",
      "  if (action !== 'musicUrl') return Promise.reject(new Error('不支持的动作: ' + action));",
      "  return Promise.resolve({ url: 'https://mock.example/' + source + '/' + info.musicInfo.id + '.mp3' });",
      "});",
    ].join('\n'), 'utf8');
    scriptPath = tmpFixture;
    console.log('未指定脚本，使用内置示例脚本：', path.basename(tmpFixture));
  } else {
    console.log('测试脚本：', scriptPath);
  }

  // 离线网络桩：按 URL 特征返回不同的“合法信封”，记录请求 URL
  const requests = [];
  const requestImpl = {
    fetch: async (url) => {
      const u = String(url);
      requests.push(u);
      let body = { code: 1 };
      if (u.includes('/urlinfo/')) {
        // flower 的版本检查：需要 code=0 + 音源列表 s
        body = { code: 0, s: 'kw|128k&tx|128k&wy|128k&kg|128k&mg|1' };
      } else if (u.includes('/url/')) {
        // flower 的取链：返回 code=0 + data 播放地址
        body = { code: 0, data: 'http://mock-music.example/audio.mp3' };
      } else {
        // 其他（如搜索）：给一个宽松的空数据
        body = { code: 0, data: [] };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        raw: Buffer.from(JSON.stringify(body)),
        url: u,
      };
    },
  };

  // 1) 原生加载：应收到 inited 能力声明
  let loaded;
  try {
    loaded = await loadScript(scriptPath, { requestImpl, name: path.basename(scriptPath) });
    check('脚本加载成功并发送 inited', !!loaded && !!loaded.sources);
  } catch (err) {
    fail++;
    console.error('  ✘ 脚本加载失败:', err.message);
    process.exitCode = 1;
    return;
  }

  const sourceKeys = Object.keys(loaded.sources);
  console.log('  声明音源：', sourceKeys.join(', ') || '（无）');
  for (const k of sourceKeys) {
    console.log('    ' + k + ':', ((loaded.sources[k].actions || [])).join(', '));
  }
  check('声明了至少一个音源', sourceKeys.length > 0);

  // 2) 适配层搜索（声明了 search 才测；纯 musicUrl 源跳过搜索断言）
  const 扩展源 = await createLxSource(scriptPath, { requestImpl, name: path.basename(scriptPath) });
  console.log('  搜索源：', 扩展源.searchSources.join(', ') || '（无，纯取链源）');
  if (扩展源.searchSources.length) {
    let list = [];
    try {
      list = await 扩展源.search('测试', 10);
      check('扩展源.search 不抛异常', true);
    } catch (err) {
      check('扩展源.search 不抛异常', false, err.message);
    }
    check('扩展源.search 返回数组', Array.isArray(list));
    console.log('  离线 search 结果数：', list.length);
  }

  // 3) musicUrl（flower 的核心能力；sixyin 若声明也应工作）
  if (sourceKeys.length && 扩展源.supports(sourceKeys[0], 'musicUrl')) {
    try {
      const url = await 扩展源.getPlayUrl(sourceKeys[0], { id: 'test-id', songmid: 'TESTMID', hash: 'TESTHASH' }, '128k');
      check(`getPlayUrl(${sourceKeys[0]}) 离线桩成功`, /^http/.test(url), url);
    } catch (err) {
      check(`getPlayUrl(${sourceKeys[0]}) 可控错误（桩数据不匹配属预期）`, /未返回播放地址|不支持|服务器异常|fetch/i.test(String(err.message || err)), String(err.message || err).slice(0, 80));
    }
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('测试运行异常:', err);
  process.exit(1);
});