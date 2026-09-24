# 声浪 SongWave

> 音画一体的音乐播放器：**在线搜索播放 + 本地音乐 + Song-Life 可视化引擎**。
> 独立新应用，不 fork、不依赖 LX Music 桌面端，LX 在 GitHub 的更新与我们无关。

---

## 为什么有这个项目

- **Song-Life（声命）**：惊艳的音域地形可视化（48×48 光柱网格、13 套主题），但缺曲库。
- **LX Music（洛雪）**：强大曲库/歌词/下载，但自带可视化较基础，且桌面端需长期跟上游更新。
- **SongWave（声浪）**：把 Song-Life 引擎原样搬进一个新播放器，自建音源解析层（当前为网易云公开接口），两者互不影响。

## 快速开始

```bash
cd F:\projects\songwave
npm install          # 安装 electron / electron-builder（需联网）
npm start            # 启动应用
```

> 提示：如果 `npm install` 走镜像/慢，可先设置 npm 镜像再装；应用本身不依赖 LX Music。

## 功能（v0.1 MVP）

- [x] 在线搜索（网易云公开搜索接口）
- [x] 在线播放（`music.163.com/song/media/outer/url` 直链，免登录；VIP/版权受限歌曲会失败，属预期）
- [x] 本地音乐导入（多选文件，file:// 播放）
- [x] 播放列表（增删、上/下一首、自动连播、本地持久化）
- [x] 播放控制条（播放/暂停、进度、音量）
- [x] Song-Life 可视化引擎（WebGL 优先 + Canvas 回退）
- [x] 13 套主题 + 参数面板（律动/响应/闪烁/亮度/视角/色相/鼠标波动/音柱材质）
- [ ] 歌词显示
- [ ] 多音源（可插拔 `src/sources/*.js`，后续接更多源）
- [ ] 下载功能
- [ ] 桌面歌词 + 壁纸模式

## 目录结构

```
songwave/
├── app/                 # 渲染层
│   ├── index.html       # 播放器 UI（搜索/列表/控制条/可视化面板）
│   ├── renderer.js      # 播放逻辑
│   ├── engine.js        # Song-Life 引擎（来自 song-life，MIT，原样拷贝）
│   ├── style.css        # Song-Life 基础样式（原样拷贝）
│   ├── player.css       # 播放器布局覆盖
│   └── icon.png
├── electron/
│   ├── main.js          # 主进程：窗口 + IPC（搜索/直链/本地文件）
│   └── preload.js       # 安全桥
├── src/sources/         # 音源层（Node，可插拔）
│   └── netease.js       # 网易云：search() / getPlayUrl()
├── scripts/
│   └── test-sources.js  # 音源冒烟测试（npm run test:sources）
└── docs/
```

## 架构

```
渲染层 (index.html + renderer.js)
   │  搜索/直链/本地文件
   ▼
preload (contextBridge)
   ▼
主进程 (electron/main.js)
   ▼
音源层 (src/sources/netease.js) ──HTTP──▶ music.163.com
   │
渲染层 audio <audio> ──▶ engine.initFile(audio) ──▶ AnalyserNode ──▶ 可视化引擎
```

## 新增音源

在 `src/sources/` 下新建 `xxx.js`，导出 `search(keywords)` 与 `getPlayUrl(id)`，再到 `electron/main.js` 里注册 IPC 即可。

## 打包

```bash
npm run build:win          # 安装版 + 便携版（产物在 dist/）
npm run build:portable     # 仅便携版
npm run build:installer    # 仅安装版
```

## 许可证与声明

- Song-Life 引擎：MIT（版权归 Song-Life 作者）
- SongWave 本体：MIT
- 在线音源仅供个人学习与试听，请尊重版权；公开发布前请自行评估合规性。

## Roadmap

- [ ] 多音源（QQ/酷狗/咪咕/自定义 lx 音源脚本）
- [ ] 歌词 + 翻译
- [ ] 下载（含歌词/封面）
- [ ] 桌面歌词 / 壁纸模式（Wallpaper Engine Web 壁纸）
- [ ] 音效（EQ / 混响 / 变调，参考 LX 高级音频功能）