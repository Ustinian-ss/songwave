// 声浪 SongWave · 播放地址探测与取链兜底测试（离线：mock fetch / 读源码断言接线）
// 用法：node scripts/test-audio-probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const { probeAudio, isAudioType, isPreviewClip, errText } = require('../src/audio-probe');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const originalFetch = global.fetch;
function mockFetch(impl) { global.fetch = impl; }
function jsonRes(status, headers, body) {
  return {
    ok: status >= 200 && status < 400, status: status, url: 'https://x/y',
    headers: { get: (k) => headers[String(k).toLowerCase()] || null },
    body: { cancel: async () => {} },
    text: async () => body || '', arrayBuffer: async () => new ArrayBuffer(0),
  };
}

(async () => {
  try {
    // —— Content-Type 判定 ——
    check('audio/mpeg 视为音频', isAudioType('audio/mpeg; charset=UTF-8'));
    check('audio/mp4 视为音频', isAudioType('audio/mp4'));
    check('application/ogg 视为音频', isAudioType('application/ogg'));
    check('text/html 不视为音频', !isAudioType('text/html;charset=utf8'));
    check('application/json 不视为音频', !isAudioType('application/json'));
    check('空类型不视为音频', !isAudioType(''));

    // —— 真音频：探测通过 ——
    mockFetch(async () => jsonRes(206, { 'content-type': 'audio/mpeg', 'content-length': '2', 'content-range': 'bytes 0-1/181521' }, ''));
    const okRes = await probeAudio('https://music.163.com/song/media/outer/url?id=1.mp3');
    check('探测到音频 → ok', okRes.ok === true);
    check('探测到音频 → 记录 Content-Type', okRes.contentType === 'audio/mpeg');
    check('探测到音频 → 无 unknown 标记', !okRes.unknown);
    check('Range 请求下用 content-range 还原整首大小', okRes.totalLength === 181521, String(okRes.totalLength));
    check('contentLength 仍是响应实际长度（2）', okRes.contentLength === 2, String(okRes.contentLength));
    check('据此判定为试听片段（约 11 秒）', isPreviewClip(okRes.totalLength, 232000) === true);
    check('试听秒数估算 ≈ 11 秒（不再是 1 秒）', Math.round(okRes.totalLength / 16000) === 11, String(Math.round(okRes.totalLength / 16000)));

    // 服务器忽略 Range 时，content-length 就是整长
    mockFetch(async () => jsonRes(200, { 'content-type': 'audio/mpeg', 'content-length': '8900000' }, ''));
    const noRange = await probeAudio('https://x/full.mp3');
    check('无 content-range 时回落到 content-length', noRange.totalLength === 8900000, String(noRange.totalLength));
    check('整曲不会被误判成试听', isPreviewClip(noRange.totalLength, 232000) === false);

    // —— 网易云无版权：302 到 404 HTML（野火-戾格 实测就是这样） ——
    mockFetch(async () => jsonRes(200, { 'content-type': 'text/html;charset=utf8' }, '<html>404</html>'));
    const bad = await probeAudio('https://music.163.com/song/media/outer/url?id=1981028372.mp3');
    check('返回 HTML → 判定不可播', bad.ok === false);
    check('不可播原因可读（提到不是音频）', bad.reason.indexOf('不是音频') >= 0, bad.reason);
    check('不可播时不是 unknown（要阻断播放）', !bad.unknown);

    mockFetch(async () => jsonRes(404, { 'content-type': 'text/html' }, ''));
    const nf = await probeAudio('https://x/404.mp3');
    check('HTTP 404 → 判定不可播且原因含状态码', nf.ok === false && nf.reason.indexOf('404') >= 0, nf.reason);

    // —— 探测本身失败（网络抖动）：不能误判成"没版权" ——
    mockFetch(async () => { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; });
    const netErr = await probeAudio('https://x/y.mp3', { timeout: 500 });
    check('网络失败 → ok=false 但标记 unknown', netErr.ok === false && netErr.unknown === true);
    check('unknown 时原因含底层错误', netErr.reason.indexOf('fetch failed') >= 0, netErr.reason);

    // —— 试听片段判定（酷我实测：181KB / 232 秒 → 试听） ——
    check('181KB @232s → 试听片段', isPreviewClip(181521, 232000) === true);
    check('8.9MB @232s（320kbps 整曲）→ 不是试听', isPreviewClip(8900000, 232000) === false);
    check('时长未知 → 不判为试听（宁可放）', isPreviewClip(181521, 0) === false);
    check('长度未知 → 不判为试听', isPreviewClip(0, 232000) === false);
    check('11 秒短视频 @232s → 试听', isPreviewClip(176000, 232000) === true);

    // —— 错误信息要带 err.cause（这次排查 fetch failed 就是因为日志缺它） ——
    const e2 = new Error('fetch failed');
    e2.cause = new Error('getaddrinfo ENOTFOUND m.kugou.com');
    check('errText 展开 cause', errText(e2).indexOf('ENOTFOUND') >= 0, errText(e2));
    check('errText 处理空值', errText(null) === '未知错误');

    // —— 接线断言：源码必须真的用上这些逻辑（防止改回去/没打包进去） ——
    const neteaseSrc = read('src/sources/netease.js');
    check('netease 取链会探测地址', neteaseSrc.indexOf('probeAudio') >= 0);
    check('netease 无版权时抛错（不静默）', neteaseSrc.indexOf('没有该歌曲的播放版权') >= 0);
    check('netease 探测结果有缓存', neteaseSrc.indexOf('probeCache') >= 0);
    check('netease 支持 validate:false（离线测试用）', neteaseSrc.indexOf('validate === false') >= 0);

    const mainSrc = read('electron/main.js');
    check('main 里有原生取链映射 NATIVE_PLAY_MAP', mainSrc.indexOf('NATIVE_PLAY_MAP') >= 0);
    check('main 换源顺序：扩展音源在前、原生兜底在后',
      mainSrc.indexOf("via: 'ext:'") > 0 && mainSrc.indexOf("via: 'native:'") > mainSrc.indexOf("via: 'ext:'"));
    check('main 会用试听片段提示', mainSrc.indexOf('isPreviewClip') >= 0);
    check('main 日志带 err.cause 明细', mainSrc.indexOf('errText(err)') >= 0);

    const platSrc = read('src/sources/platforms.js');
    check('酷我用 search.kuwo.cn/r.s（不再用被 csrf 拦的 api/www）',
      platSrc.indexOf('search.kuwo.cn/r.s') >= 0 && platSrc.indexOf('api/www/search') < 0);
    check('酷我有原生 getPlayUrl（anti.s）', platSrc.indexOf('antiserver.kuwo.cn/anti.s') >= 0);

    const rendererSrc = read('app/renderer.js');
    check('界面会显示取链警告（试听片段）', rendererSrc.indexOf('r.warn') >= 0);
    check('换源会跳过只有试听的平台、优先找完整版',
      rendererSrc.indexOf('previewOnly') >= 0 && rendererSrc.indexOf('继续找完整版') >= 0);
    check('同一首换源并发只跑一次（避免 12 秒后覆盖成功提示）',
      rendererSrc.indexOf('const switching = new Map()') >= 0 && rendererSrc.indexOf('async function doAutoSwitch') >= 0);
    check('进度记忆不会续播到结尾（试听片段会一开就结束）', rendererSrc.indexOf('duration - t < 3') >= 0);
    check('试听片段播完不再报"换源失败"', rendererSrc.indexOf('试听片段播放结束') >= 0);
    check('已用试听片段的曲目不再重复换源', rendererSrc.indexOf('previewTracks') >= 0);
    check('搜索回退不再改写用户选的音源',
      rendererSrc.indexOf('音源选择未改动') >= 0 && rendererSrc.indexOf("localStorage.setItem('songwave.source', curSource);\n      document.querySelectorAll('#src-chips .chip')") < 0);
    check('结果行按真实平台标源（不再一律标网易）',
      rendererSrc.indexOf("SOURCE_LABELS[item.source] || item.source") >= 0);
  } catch (e) {
    console.error('测试运行异常:', e);
    fail++;
  } finally {
    global.fetch = originalFetch;
  }
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
