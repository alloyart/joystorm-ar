# JoyStorm AR

JoyStorm AR 是一个浏览器端面部表情互动原型：微笑触发细雨，张嘴大笑触发烟花；烟花完成绽放后，其后期粒子可与用户头部区域发生轻微物理碰撞。

> A browser-based facial-expression AR prototype for rain, fireworks, and late-stage head collision.

## Live Demo

- GitHub Pages（主要提交链接）：[https://alloyart.github.io/joystorm-ar/](https://alloyart.github.io/joystorm-ar/)
- ChatGPT Sites（备用链接）：[https://joystorm-ar-demo.blond-iris-3352.chatgpt.site/](https://joystorm-ar-demo.blond-iris-3352.chatgpt.site/)

- 摄像头功能需要 HTTPS 或 `localhost`。
- 首次进入时需要允许浏览器访问摄像头。
- 浏览器策略、设备性能与摄像头能力会影响实际体验；移动端和真机兼容性仍需在公开发布前完成最终确认。

## 交互说明

| 输入或动作 | 系统行为 |
|---|---|
| 自然表情 | 收集有效样本并完成中性基线校准 |
| 闭嘴微笑 | 进入微笑状态并触发雨水 |
| 张嘴大笑 | 进入大笑状态、停止生成新雨滴并触发烟花 |
| 头部移动 | 与烟花完成绽放后的后期粒子及四芒星发生轻微碰撞 |
| 模拟体验 | 摄像头不可用时，通过中性、微笑和大笑按钮演示对应效果 |

微笑与大笑是互斥状态，大笑优先于微笑。烟花绽放阶段不会因人脸遮挡而绕开或改变形态。

## 本地运行

### 环境要求

- Node.js `22.13.0` 或更高版本；仓库中的 `.nvmrc` 固定了推荐版本。
- npm（随 Node.js 安装）。
- 支持摄像头与 WebAssembly 的现代浏览器。

公开代码仓库：[https://github.com/alloyart/joystorm-ar](https://github.com/alloyart/joystorm-ar)

可使用 HTTPS 克隆：

```bash
git clone https://github.com/alloyart/joystorm-ar.git
cd joystorm-ar
```

进入项目目录后，可直接复制执行：

```bash
nvm use
npm ci
npm run dev:local
```

开发服务器默认地址为 [http://localhost:5173](http://localhost:5173)。如果端口被占用，请以终端输出为准。

常用验证命令：

```bash
npm run lint:local
npm run test:local
npm run build:local
npm run build:pages
```

`dev:local`、`lint:local`、`build:local`、`build:pages` 与 `test:local` 不依赖 Bash、`flock` 或 GNU `timeout`，适合 Windows、macOS 和 Linux 的本地评审。原有 `npm run dev`、`npm run lint`、`npm run build` 与 `npm test` 保留给当前 Sites 构建与发布环境。

## 技术架构

- MediaPipe Face Landmarker 在浏览器中提供面部关键点与表情 Blendshape 数据。
- 独立的感知循环负责限频推理与表情判断，Canvas 动画循环负责雨水、烟花及碰撞反馈渲染。
- 表情状态经过中性校准、分数平滑、进入/退出迟滞与冷却处理，并保持微笑和大笑互斥。
- 头部碰撞区域由当前面部关键点估算；烟花后期粒子复用该区域进行轻微碰撞。
- 摄像头和模型启动使用 generation token；过期任务不能覆盖当前模式，并会释放其流与模型实例。

## 性能设计

- 人脸推理与 Canvas 渲染解耦，人脸推理按固定间隔限频。
- 雨水、涟漪、烟花及碰撞反馈均受粒子预算或数量上限约束。
- 系统根据设备能力与运行状况选择性能档位，并限制画布像素倍率。
- MediaPipe 运行库按需动态加载。
- 页面进入后台或结束体验时，当前实现会停止摄像头轨道、关闭模型并清理运行状态；返回页面后需要用户主动重新开启。

以上是代码层面的设计约束，不代表所有设备上的固定帧率、内存或耗电指标。

## 隐私说明

当前实现使用浏览器的 `getUserMedia` 与本地加载的 MediaPipe 资源处理摄像头画面。代码中未实现视频录制，也未实现将视频帧、面部关键点、Blendshape 或诊断结果上传或持久化的网络接口。页面隐藏、停止体验或组件卸载时会释放摄像头与模型资源。

浏览器、操作系统和托管平台自身的权限提示及网络行为不由本项目代码控制；使用者仍应依据实际部署环境复核隐私政策和浏览器开发者工具中的网络请求。

## 浏览器与已知限制

- 需要支持 `getUserMedia`、Canvas 和 WebAssembly 的现代浏览器。
- 非 HTTPS 的远程页面通常不能请求摄像头；本地开发可使用 `localhost`。
- 权限策略、摄像头朝向、画面裁切、光线和设备性能均可能影响识别与碰撞对齐。
- 桌面 Chrome、iPhone Safari 与 Android Chrome 的最终真机验证将在公开发布前完成；本文不声明已全面兼容所有设备。

## 测试与安全

自动测试覆盖摄像头生命周期与启动竞态、中性校准、互斥表情状态、特效触发边界、粒子预算和页面结构等行为。可使用以下命令复核：

```bash
npm run lint:local
npm run test:local
npm audit --omit=dev
```

安全审计结果只代表执行命令时的依赖状态，并非对未来漏洞状态的永久保证。真人表情准确性、摄像头权限差异和跨设备碰撞对齐仍需真机测试。

## 许可证

项目贡献者拥有的原创代码采用 [MIT License](./LICENSE)。该许可不会自动覆盖第三方依赖、MediaPipe 运行文件与模型、OpenAI Sites starter 资产、生成图片、商标或其他外部资产；这些内容适用各自的许可证或服务条款。详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
