// 声浪 SongWave · LX 用户音源脚本运行时测试（离线，无需网络/Electron）
// 用法：node scripts/test-lx-runtime.js [脚本路径]
// 默认测试 D:\小程序\lxmusic\flower-v1.0.0.js，可传参换 sixyin 等
'use strict';

const path = require('path');
const fs = require('fs');
const { loadScript } = require('../src/sources/lx-runtime');
const { createLxSource } = require('../src/sources/lx-source');

const DEFAULT_SCRIPT = process.env.SONGWAVE_LX_SCRIPT || 'D:\\小程序\\lxmusic\\flower-v1.0.0.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

async function main() {
  const scriptPath = process.argv[2] || DEFAULT_SCRIPT;
  console.log('测试脚本：', scriptPath);
  if (!fs.existsSync(scriptPath)) {
    console.error('脚本不存在，跳过（可用 SONGWAVE_LX_SCRIPT 指定其他路径）');
    return;
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
  const lx = await createLxSource(scriptPath, { requestImpl, name: path.basename(scriptPath) });
  console.log('  搜索源：', lx.searchSources.join(', ') || '（无，纯取链源）');
  if (lx.searchSources.length) {
    let list = [];
    try {
      list = await lx.search('测试', 10);
      check('lx.search 不抛异常', true);
    } catch (err) {
      check('lx.search 不抛异常', false, err.message);
    }
    check('lx.search 返回数组', Array.isArray(list));
    console.log('  离线 search 结果数：', list.length);
  }

  // 3) musicUrl（flower 的核心能力；sixyin 若声明也应工作）
  if (sourceKeys.length && lx.supports(sourceKeys[0], 'musicUrl')) {
    try {
      const url = await lx.getPlayUrl(sourceKeys[0], { id: 'test-id', songmid: 'TESTMID', hash: 'TESTHASH' }, '128k');
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