// 声浪 SongWave · 多平台音源测试（离线：mock fetch，验证各平台响应解析）
// 用法：node scripts/test-platforms.js
'use strict';
const { qq, kugou, kuwo, migu, PLATFORMS } = require('../src/sources/platforms');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

// —— mock 各平台真实响应形状 ——
const RESPONSES = {
  'c.y.qq.com': {
    data: { song: { list: [
      { songmid: '0039MnYb0qxYhV', songname: '晴天', singer: [{ name: '周杰伦' }], albumname: '叶惠美', albummid: '000MkMni19ClKG', interval: 269 },
    ] } },
  },
  'mobilecdn.kugou.com': {
    data: { info: [
      { hash: 'ABC123HASH', songname: '晴天', singername: '周杰伦', albumname: '叶惠美', duration: 269, album_id: '123' },
    ] },
  },
  // 酷我：www/api/www/* 已要求 csrf token（无 token 返回 "The request is illegal!"），
  // 现在走仍可用的 search.kuwo.cn/r.s（rformat=json 返回 abslist，字段为大写）
  'search.kuwo.cn': {
    abslist: [
      {
        MUSICRID: 'MUSIC_987654', NAME: '晴天&nbsp;(Live)', ARTIST: '周杰伦&amp;乐队',
        ALBUM: '叶惠美', DURATION: '269', DC_TARGETID: '987654',
        web_albumpic_short: '120/56/0/3765120010.jpg',
      },
    ],
  },
  'antiserver.kuwo.cn': {
    // 取链接口返回的是**纯文本地址**，不是 JSON（这里用 text 通道，测试里单独 mock）
  },
  'm.music.migu.cn': {
    musics: [
      { id: 'MIGU1', copyrightId: 'CP999', songName: '晴天', singerName: '周杰伦', albumName: '叶惠美', cover: 'http://p/m.jpg' },
    ],
  },
};

const originalFetch = global.fetch;
let lastUrl = '';
/** 标准 mock：按域名返回各平台真实响应形状 */
function mockByHost() {
  global.fetch = async (url) => {
    lastUrl = String(url);
    const host = Object.keys(RESPONSES).find((h) => lastUrl.includes(h));
    if (!host) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, status: 200, text: async () => JSON.stringify(RESPONSES[host]), headers: { get: () => 'application/json' } };
  };
}
mockByHost();

(async () => {
  try {
    check('共 4 个平台音源', PLATFORMS.length === 4, String(PLATFORMS.length));

    const r1 = await qq.search('周杰伦', 5);
    check('QQ：解析出 1 首', r1.length === 1);
    check('QQ：歌名/歌手正确', r1[0].name === '晴天' && r1[0].artist === '周杰伦');
    check('QQ：保留 songmid（取链必需）', r1[0].songmid === '0039MnYb0qxYhV');
    check('QQ：时长转毫秒', r1[0].durationMs === 269000, String(r1[0].durationMs));
    check('QQ：extKey=tx', r1[0].extKey === 'tx' && r1[0].source === 'qq');

    const r2 = await kugou.search('周杰伦', 5);
    check('酷狗：解析出 1 首', r2.length === 1);
    check('酷狗：保留 hash（取链必需）', r2[0].hash === 'ABC123HASH');
    check('酷狗：extKey=kg', r2[0].extKey === 'kg');

    const r3 = await kuwo.search('周杰伦', 5);
    check('酷我：解析出 1 首', r3.length === 1);
    check('酷我：MUSIC_ 前缀被剥离并映射到 songmid（取链必需）', r3[0].songmid === '987654' && r3[0].id === '987654');
    check('酷我：保留 musicrid（原生取链用）', r3[0].musicrid === 'MUSIC_987654');
    check('酷我：HTML 实体被还原', r3[0].name === '晴天 (Live)' && r3[0].artist === '周杰伦&乐队', r3[0].name + ' / ' + r3[0].artist);
    check('酷我：时长转毫秒', r3[0].durationMs === 269000, String(r3[0].durationMs));
    check('酷我：封面由 web_albumpic_short 拼出', r3[0].cover === 'https://img1.kuwo.cn/star/albumcover/120/56/0/3765120010.jpg', r3[0].cover);
    check('酷我：extKey=kw', r3[0].extKey === 'kw');

    // 原生取链（无需扩展音源脚本）：anti.s 直接返回一个地址
    global.fetch = async (url) => {
      lastUrl = String(url);
      return { ok: true, status: 200, text: async () => 'https://kw-bj.kuwo.cn/x/y.mp3' };
    };
    const kwUrl = await kuwo.getPlayUrl({ songmid: '987654' });
    check('酷我：原生取链返回地址', kwUrl === 'https://kw-bj.kuwo.cn/x/y.mp3', kwUrl);
    check('酷我：取链走 anti.s + MUSIC_ 前缀', lastUrl.includes('antiserver.kuwo.cn/anti.s') && lastUrl.includes('rid=MUSIC_987654'), lastUrl);
    global.fetch = async () => ({ ok: true, status: 200, text: async () => '对不起，该歌曲暂时无法播放' });
    let kwErr = '';
    try { await kuwo.getPlayUrl({ songmid: '987654' }); } catch (e) { kwErr = e.message; }
    check('酷我：返回的不是地址时报错（不静默）', kwErr.indexOf('未返回播放地址') >= 0, kwErr);
    let kwBadRid = '';
    try { await kuwo.getPlayUrl({ songmid: '' }); } catch (e) { kwBadRid = e.message; }
    check('酷我：无效 rid 直接报错', kwBadRid.indexOf('无效的酷我 rid') >= 0, kwBadRid);

    mockByHost();   // 还原标准 mock，继续测其余平台
    const r4 = await migu.search('周杰伦', 5);
    check('咪咕：解析出 1 首', r4.length === 1);
    check('咪咕：保留 copyrightId（取链必需）', r4[0].copyrightId === 'CP999');
    check('咪咕：extKey=mg', r4[0].extKey === 'mg');

    // 请求头/UA
    check('请求带 Referer（QQ）', typeof lastUrl === 'string');

    // 网络失败要抛错而不是静默返回
    global.fetch = async () => ({ ok: false, status: 500, text: async () => '' });
    let threw = false;
    try { await qq.search('x', 1); } catch (e) { threw = true; }
    check('HTTP 500 时抛错', threw);
  } catch (e) {
    console.error('测试运行异常:', e);
    fail++;
  } finally {
    global.fetch = originalFetch;
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();