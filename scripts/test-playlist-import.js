// 声浪 SongWave · 外部歌单导入测试（离线：mock fetch）
// 用法：node scripts/test-playlist-import.js
'use strict';
const { createPlaylistImporter, extractUrls, parsePlaylistUrl, parseTextPlaylist, mapNeteasePlaylist, mapQqPlaylist } = require('../src/playlist-import');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

// LX 风格的分享文本（带密码与说明）
const SHARE_NETEASE = '分享歌单《夏日幻想》\n链接:https://music.163.com/#/playlist?id=123456789\n密码:ab12\n来自网易云音乐';
const SHARE_QQ = 'QQ音乐歌单分享 https://y.qq.com/n/ryqq/playlist/7654321 （来自QQ音乐）';
const TEXT_PLAYLIST = '晴天 - 周杰伦\n七里香 - 周杰伦\n简单爱\n\n# 注释行也当歌名? no\n';

const NET_RESP = {
  'music.163.com': {
    playlist: {
      name: '夏日幻想',
      coverImgUrl: 'http://c/cover.jpg',
      tracks: [
        { id: 111, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美', picUrl: 'http://c/1.jpg' }, dt: 269000 },
        { id: 222, name: '七里香', ar: [{ name: '周杰伦' }], al: { name: '七里香' }, dt: 299000 },
      ],
    },
  },
  'y.qq.com': {
    cdlist: [{
      dissname: 'QQ歌单',
      logo: 'http://c/qq.jpg',
      songlist: [
        { songmid: 'MID001', songname: '夜曲', singer: [{ name: '周杰伦' }], albumname: '十一月的萧邦', albummid: 'AM001', interval: 227 },
      ],
    }],
  },
};

async function main() {
  // 1) 链接提取与平台识别
  check('从分享文本提取链接', extractUrls(SHARE_NETEASE)[0] === 'https://music.163.com/#/playlist?id=123456789', extractUrls(SHARE_NETEASE)[0]);
  check('识别网易云歌单', JSON.stringify(parsePlaylistUrl('https://music.163.com/#/playlist?id=123456789')) === JSON.stringify({ platform: 'netease', id: '123456789', source: 'netease' }));
  check('识别 QQ 歌单', (parsePlaylistUrl(SHARE_QQ.match(/https?:\/\/\S+/) [0]) || {}).platform === 'qq');
  check('无法识别的链接返回 null', parsePlaylistUrl('https://example.com/x') === null);
  check('识别 qq disstid 参数', (parsePlaylistUrl('https://y.qq.com/n/ryqq/playlist?disstid=999') || {}).id === '999');

  // 2) 文本歌单
  const textItems = parseTextPlaylist(TEXT_PLAYLIST);
  check('文本歌单解析出 4 行', textItems.length === 4, String(textItems.length));
  check('歌名/歌手拆分正确', textItems[0].name === '晴天' && textItems[0].artist === '周杰伦');
  check('无歌手时只留歌名', textItems[2].name === '简单爱' && textItems[2].artist === '');
  check('文本条目标记为待搜索', textItems[0].source === 'search' && textItems[0].type === 'pending');

  // 3) 映射函数
  const net = mapNeteasePlaylist(NET_RESP['music.163.com']);
  check('网易歌单名与封面', net.name === '夏日幻想' && net.cover === 'http://c/cover.jpg');
  check('网易歌曲映射（含时长毫秒）', net.items.length === 2 && net.items[0].durationMs === 269000);
  check('网易歌手合并', net.items[0].artist === '周杰伦');
  const qq = mapQqPlaylist(NET_RESP['y.qq.com']);
  check('QQ 歌曲映射并保留 songmid', qq.items[0].songmid === 'MID001' && qq.items[0].extKey === 'tx');

  // 4) 端到端（mock fetch）
  const importer = createPlaylistImporter({
    fetchImpl: async (url) => {
      const host = Object.keys(NET_RESP).find((h) => String(url).includes(h));
      if (!host) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(NET_RESP[host]) };
    },
  });
  const r1 = await importer.importFromText(SHARE_NETEASE);
  check('端到端导入网易歌单', r1.platform === 'netease' && r1.items.length === 2, JSON.stringify(r1.name));
  const r2 = await importer.importFromText(SHARE_QQ);
  check('端到端导入 QQ 歌单', r2.platform === 'qq' && r2.items.length === 1);
  const r3 = await importer.importFromText(TEXT_PLAYLIST);
  check('端到端导入文本歌单', r3.platform === 'text' && r3.items.length === 4);

  let err = null;
  try { await importer.importFromText('https://example.com/nothing'); } catch (e) { err = e.message; }
  check('不支持的链接报错清晰', /无法识别/.test(String(err)), String(err));
  let err2 = null;
  try { await importer.importFromText('   '); } catch (e) { err2 = e.message; }
  check('空内容报错清晰', /没有识别到歌单内容/.test(String(err2)), String(err2));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('测试运行异常:', e); process.exit(1); });