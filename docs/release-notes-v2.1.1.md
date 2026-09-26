# 声浪 SongWave v2.1.1

修「**播放时律动没了、一直是一个循环律动（像是没检测到）**」。

## 根因（实测）

可视化的两条取音路径各有硬伤，这次都撞上了：

1. **系统回环**：Chromium/WASAPI 回环**会排除本进程自己的音频** —— 本应用自己放歌时，
   回环流是"live 但恒为 0"。实测：回环流本身正常（1 条 `System audio` 音轨、48kHz、live），
   但接上分析器后 `audioLevel` 恒为 0 → 超过静音阈值 6 秒就切成演示动画，
   而演示动画是时间的确定性函数 → 看起来就是"一直在循环同一个律动"。
2. **直接分析**：`createMediaElementSource` 最准，但**跨域且不带 CORS 的 CDN**
   （酷我 `kw-er.kuwo.cn` / `kw-bj.kuwo.cn` 实测无 `Access-Control-Allow-Origin`）
   会让 Web Audio 变成"脏图"：分析数据恒为 0，甚至把声音也静音。

## 修法：本机 CORS 代理 + 直连分析

- 新增 `src/audio-proxy.js`：把在线音频经 `http://127.0.0.1:<随机端口>` 代理一层，
  补上 `Access-Control-Allow-Origin: *`，并透传 `Range`/`Content-Range`（进度拖动不受影响）、
  流式转发不占内存；`Content-Type`/状态码原样透传。
- 播放时 `audio.src` 用代理地址（取链结果新增 `playUrl`，失败自动回退原始地址）。
- 有代理地址时**优先直连分析**（`ensureEngine(true)`），本地文件同理；
  代理不可用时才退回系统回环——两条路都保留。

## 实测验证（CDP 读引擎内部状态）

```
取链:    via: ext:kw @ 全豆要聚合音源    playUrl: http://127.0.0.1:60716/a?u=…
+3s  →  dur=233s  level=0.6359  silentFor=0  audioOn=true  paused=false
+6s  →  dur=233s  level=0.6164  silentFor=0
+10s →  dur=233s  level=0.6420  silentFor=0
```

`level` 稳定在 0.6 以上、`silentFor` 归零 → 分析器拿到真实频谱，律动跟着音乐跳；
同时 `duration=233s` 说明酷我 VIP 那首也是完整版。

## 测试

`npm run test:all` —— **19 套 / 487 条断言全部通过**。

---

安装包：`SongWave-Setup-2.1.1.exe`（未签名，SmartScreen 提示时选"更多信息 → 仍要运行"）。
