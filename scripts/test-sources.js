// 声浪 SongWave · 音源层冒烟测试（需要联网，用户机器上执行）
// 用法：npm run test:sources [关键词]
'use strict';
const netease = require('../src/sources/netease');

async function main() {
  const kw = process.argv[2] || '周杰伦';
  console.log('搜索：', kw);
  const list = await netease.search(kw, 5);
  console.log('结果数：', list.length);
  for (const it of list.slice(0, 5)) {
    console.log('-', it.id, it.name, '/', it.artist, '/', it.album);
  }
  if (list.length) {
    const url = await netease.getPlayUrl(list[0].id);
    console.log('播放直链：', url);
  }
  console.log('OK: 音源层工作正常');
}

main().catch((err) => {
  console.error('FAIL:', err && err.message || err);
  console.error('（如果无网络，或网易接口变更，属预期失败）');
  process.exit(1);
});