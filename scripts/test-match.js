// 声浪 SongWave · 换源匹配打分测试（离线）
// 用法：node scripts/test-match.js
'use strict';
const { normalizeTitle, artistList, scoreMatch, pickAlternatives } = require('../src/match');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

// 1) 归一化
check('去括号内容', normalizeTitle('晴天 (Live版)') === '晴天', normalizeTitle('晴天 (Live版)'));
check('去标点空格', normalizeTitle('七里香 - 周杰伦') === '七里香周杰伦', normalizeTitle('七里香 - 周杰伦'));
check('去 feat/remix 词', normalizeTitle('夜曲 feat. 阿信') === '夜曲', normalizeTitle('夜曲 feat. 阿信'));
check('大小写统一', normalizeTitle('Hello World') === 'helloworld');
check('歌手拆分', artistList('周杰伦 / 阿信').join('|') === '周杰伦|阿信');

// 2) 打分
const q = { name: '晴天', artist: '周杰伦', durationMs: 269000 };
const perfect = { name: '晴天', artist: '周杰伦', durationMs: 269000 };
const liveVer = { name: '晴天 (Live)', artist: '周杰伦', durationMs: 275000 };
const otherArtist = { name: '晴天', artist: '某翻唱歌手', durationMs: 269000 };
const wrongSong = { name: '七里香', artist: '周杰伦', durationMs: 299000 };
const wrongDuration = { name: '晴天', artist: '周杰伦', durationMs: 180000 };

const sPerfect = scoreMatch(q, perfect);
const sLive = scoreMatch(q, liveVer);
const sOther = scoreMatch(q, otherArtist);
const sWrong = scoreMatch(q, wrongSong);
const sDur = scoreMatch(q, wrongDuration);
console.log('  分数：完美=' + sPerfect + ' Live=' + sLive + ' 异歌手=' + sOther + ' 异曲=' + sWrong + ' 时长差大=' + sDur);

check('同曲同歌手得分最高', sPerfect > sLive && sPerfect > sOther);
check('Live 版仍算匹配', sLive >= 80, String(sLive));
check('异歌手得分被扣分', sOther < sPerfect, String(sOther));
check('时长差大要扣分', sDur < sPerfect, String(sDur));
check('不同歌曲判定为不匹配', sWrong < 45, String(sWrong));

// 3) 选源
const groups = [[
  { source: 'netease', id: 'n1', name: '晴天', artist: '周杰伦', durationMs: 269000 },
  { source: 'qq', id: 'q1', name: '晴天', artist: '周杰伦', durationMs: 269000 },
  { source: 'kugou', id: 'k1', name: '晴天 (Live)', artist: '周杰伦', durationMs: 275000 },
  { source: 'kuwo', id: 'w1', name: '七里香', artist: '周杰伦', durationMs: 299000 },
], [
  { source: 'migu', id: 'm1', name: '晴天', artist: '周杰伦', durationMs: 269000 },
]];
const alts = pickAlternatives(q, groups, { excludeSources: ['netease'], limit: 5 });
console.log('  选源顺序：', alts.map((a) => a.source + '(' + a._score + ')').join(' > '));
check('排除已失败平台', alts.every((a) => a.source !== 'netease'));
check('不含不匹配歌曲', alts.every((a) => a.name.indexOf('七里香') < 0));
check('按分数降序', alts.every((a, i) => i === 0 || alts[i - 1]._score >= a._score));
check('跨平台汇总到候选里', alts.some((a) => a.source === 'migu') && alts.some((a) => a.source === 'qq'));
check('limit 生效', pickAlternatives(q, groups, { limit: 2 }).length <= 2);
check('空输入安全', pickAlternatives({}, []) .length === 0 && scoreMatch({}, {}) === 0);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);