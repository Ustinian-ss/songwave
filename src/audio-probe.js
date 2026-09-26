// 声浪 SongWave · 播放地址可用性探测（纯 Node，无第三方依赖）
//
// 为什么需要它：平台的「歌词接口」和「播放接口」授权是**分开**的。
// 典型情况（实测）：网易云 野火-戾格 outer/url 会 302 到 https://music.163.com/404，
// 返回 Content-Type: text/html —— 歌词拿得到、音频元素却永远不响，
// 用户看到的就是「歌词有了但不播放」。所以取链时必须当场判定。
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** 这些 Content-Type 视为可播放音频 */
function isAudioType(ct) {
  const t = String(ct || '').toLowerCase();
  return t.indexOf('audio/') === 0 ||
    t.indexOf('application/ogg') === 0 ||
    t.indexOf('video/mp4') === 0 ||
    t.indexOf('application/octet-stream') === 0;
}

/**
 * 只取响应头，判断这个地址是不是真音频
 * @returns {Promise<{ok:boolean,status:number,contentType:string,contentLength:number,finalUrl:string,reason:string,unknown?:boolean}>}
 *   unknown=true 表示探测本身失败（网络抖动等）——此时**不应**判定歌曲不可播，交给播放器去试。
 */
async function probeAudio(url, opts = {}) {
  const timeout = Number(opts.timeout) || 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: Object.assign({ 'User-Agent': UA, Range: 'bytes=0-1' }, opts.headers || {}),
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    const contentLength = Number(res.headers.get('content-length')) || 0;
    // 我们发的是 Range: bytes=0-1，所以 content-length 往往只有 2 字节；
    // 整首文件大小在 content-range（bytes 0-1/181521）里，必须取它，
    // 否则「试听片段判定」会把每首歌都算成 1 秒。
    const contentRange = res.headers.get('content-range') || '';
    const totalMatch = /\/(\d+)\s*$/.exec(contentRange);
    const totalLength = totalMatch ? Number(totalMatch[1]) : contentLength;
    const finalUrl = res.url || url;
    // 只要响应头：立刻断开，别把整首歌拉下来
    try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (e) { /* ignore */ }
    const ok = isAudioType(contentType) && res.status >= 200 && res.status < 400;
    return {
      ok: ok,
      status: res.status,
      contentType: contentType,
      contentLength: contentLength,
      totalLength: totalLength,
      contentRange: contentRange,
      finalUrl: finalUrl,
      reason: ok ? '' : (res.status >= 400
        ? ('HTTP ' + res.status)
        : ('返回的不是音频（' + (contentType || '未知类型') + '）')),
    };
  } catch (err) {
    return {
      ok: false, status: 0, contentType: '', contentLength: 0, totalLength: 0, contentRange: '', finalUrl: url,
      reason: String((err && err.message) || err), unknown: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 判断是否为"试听片段"：按 128kbps 估算整首歌应有的字节数，实际远小于它即为试听
 * （实测酷我 anti.s 对会员歌返回约 11 秒的 mp3，约 181KB）
 * @param {number} totalBytes 整首文件字节数（注意用 probeAudio 的 totalLength，不是 Range 下的 contentLength）
 */
function isPreviewClip(totalBytes, durationMs) {
  const len = Number(totalBytes) || 0;
  const dur = Number(durationMs) || 0;
  if (!len || dur < 20000) return false;
  const expected = (dur / 1000) * 16000;   // 128kbps ≈ 16KB/s
  return len < expected * 0.45;
}

/** 把错误（含 fetch 的 err.cause）整理成一行可读文本——日志排查用 */
function errText(err) {
  if (!err) return '未知错误';
  const parts = [String(err.message || err)];
  let cause = err.cause;
  let depth = 0;
  while (cause && depth < 4) {
    parts.push(String(cause.message || cause.code || cause));
    cause = cause.cause;
    depth++;
  }
  return parts.join(' ← ');
}

module.exports = { probeAudio, isAudioType, isPreviewClip, errText, UA };
