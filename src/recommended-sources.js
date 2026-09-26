// 声浪 SongWave · 推荐音源列表（一键导入）
//
// 说明：这些是社区维护的第三方音源脚本，脚本**不随本应用分发**，只在用户点击"一键导入"时
// 从公开地址下载（与在播放器里粘贴链接导入是同一件事）。取链是否可用取决于脚本作者的服务，
// 实测结果见 note，随时可能变化 —— 所以面板里还有「音源体检」可以随时复测。
'use strict';

const MIRROR = 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/';
const RAW = 'https://raw.githubusercontent.com/pdone/lx-music-source/main/';

/** 镜像优先（国内网络更稳），失败自动回退原始地址 */
function make(id, name, note) {
  return { id: id, name: name, note: note, url: MIRROR + id + '/latest.js', fallback: RAW + id + '/latest.js' };
}

const list = [
  make('qdy', '全豆要聚合音源', '实测：酷我/网易云 全平台完整版（含 VIP 歌；QQ/酷狗走代理）'),
  make('huanyin', '幻音音源', '实测：多平台走代理取链，适合酷我/网易云备选'),
  make('changqing', '长青音源', '实测：多平台聚合，作为二次备选'),
  make('sixyin', '六音音源', '实测：声明全平台，初始化较慢，作为三次备选'),
];

module.exports = { list: list, MIRROR: MIRROR, RAW: RAW };
