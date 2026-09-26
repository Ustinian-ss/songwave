# 声浪 SongWave v2.0.8

你反馈的"**源的使用有问题，很多歌和 LX 不一样**"——查下去确实是我的音源调用链有 bug，这条更新主要修它。

## 1. 致命 bug：同一平台装了多个脚本时，我只用了「第一个」

你的音源目录里实际有 **6 条**记录，其中**两条都叫「野花🌷」**：

| # | 名称 | 版本 | 文件 | 状态 |
| --- | --- | --- | --- | --- |
| 2 | 野花🌷 | 1.0.0 | 7452 字节（旧版，域名 `flower.tempmusics.tk` 已废弃） | 启用 |
| 5 | 野花🌷 | 1 | 10057 字节（新版 `latest.js`，你现在用的那个） | 启用 |

旧代码 `findSourceFor()` **只取第一个支持该平台的脚本** → 永远撞在旧版上 →
`getaddrinfo ENOTFOUND flower.tempmusics.tk` → 取链失败。新版脚本压根没被调用过。

现在改成 **`resolveViaExtSources()`：把支持该平台的所有脚本按"健康度"排序后逐个真试**：

- 最近成功过的排最前；最近失败过的排最后（5 分钟冷却），但**不剔除**（只有一个脚本时仍要试）；
- 每个脚本单次尝试有 **12 秒独立超时**，坏脚本不会拖住播放；
- 结果写进日志，明确的「哪个脚本失败、失败原因是什么」：

```
音源脚本失败(kw musicUrl @ 野花🌷): fetch failed ← getaddrinfo ENOTFOUND flower.tempmusics.tk
音源脚本失败(kw musicUrl @ 六音音源): HTTP 403
音源脚本失败(kw musicUrl @ 野花🌷): HTTP 404
```

## 2. 致命 bug：脚本的 `@version` 从来没传给脚本

音源脚本的头部注释是它的**自述元信息**，LX 会把它作为 `lx.currentScriptInfo` 交给脚本。
你这份 flower 脚本会拿 `currentScriptInfo.version` 去校验版本、并作为请求头 `source-ver` 发给它自己的接口
——这个字段为空时，脚本**连 inited 都发不出来**（我用沙箱验证：修好前初始化直接失败，修好后正常声明 `kw/wy/mg/tx/kg`）。

现在 `loadScript()` 会解析脚本头部的
`@name / @version / @description / @author / @homepage`，**优先用脚本自己声明的值**（外部登记表只在脚本没写时兜底）。

## 3. 新增「音源体检」按钮（音源管理面板）

一次点击，逐个脚本真取一首酷我歌，结果直接写在面板上：

```
❌ 野花🌷 v1.0.0：fetch failed ← getaddrinfo ENOTFOUND flower.tempmusics.tk (17ms)
❌ 六音音源 v1.2.1：HTTP 403 (644ms)
❌ 野花🌷 v1：HTTP 404 (419ms)
```

这样"到底哪个音源能用"不再靠猜。体检结果同时会记进音源健康度表，之后的播放会优先用能用的那个。

## 4. 关于「LX 能播酷我、我这边 404」的实测结论

我把这份 `latest.js` 在沙箱里跑通到了最后一步（脚本正常初始化、正常构造请求），它请求的是它自己写死的接口：

```
GET http://97.64.37.235/flower/v1/url/kw/239211505/music
headers: { User-Agent: lx-music/desktop, ver: 2.0.0, source-ver: 1, tag: <hex> }
→ 404 Not Found
```

从我这台机器实测的各种可能都试过了：换 `ver`（2.0.0/2.11.0/2.6.0/1.22.0）、换 `source-ver`、加签名参数、
`Host: flower.tempmusics.tk`（变 403）、HTTPS、DoH 解析旧域名 —— **都是 403/404 或超时**，说明是**网络侧（地域/线路）限制**，
不是调用方式问题（脚本发出的请求与它自身逻辑一致，我这边已经是"照 LX 的方式在调"）。

所以：**请装 2.0.8 后点一下「音源体检」**。

- 如果新版野花显示 ✅ → 你的网络能通，问题解决（QQ/酷狗/酷我/咪咕 都会走它取链）；
- 如果同样是 ❌ 404 → 那是这个脚本自身接口的问题，建议在「音源管理」里换一个还能用的脚本（体检按钮可以逐个验证）。

另外旧版野花（7452 字节）建议在音源管理里**停用或删除**，它只会拖慢每次取链。

## 5. 其它

- 调试开关（可选，排查音源脚本用）：`SW_DEBUG_LX=1`（打印脚本读的字段）、`SW_DEBUG_UTILS=1`（打印缺失的 utils 调用）、`SW_LX_VERSION=x.y.z`（伪造宿主版本号）；
- 新增测试：`scripts/test-source-pick.js`（26 条）覆盖候选排序、健康度、脚本头元信息解析与主进程接线；
- `npm run test:all` —— **18 套 / 453 条断言全部通过**。

---

安装包：`SongWave-Setup-2.0.8.exe`（未签名，SmartScreen 提示时选"更多信息 → 仍要运行"）。
