# Third-Party Notices

本文记录 JoyStorm AR 仓库中直接提交的第三方模型、运行文件和 starter 资产，以及应用直接声明的生产依赖。项目根目录的 MIT License 仅适用于项目贡献者拥有权利的原创代码，不会取代下列许可证、服务条款、商标规则或其他权利限制。

## 1. MediaPipe Face Landmarker 模型包

| 项目 | 记录 |
|---|---|
| 仓库路径 | `public/models/face_landmarker.task` |
| 用途 | Face Landmarker 的人脸检测、面部网格与表情 Blendshape 推理 |
| 上游 | Google MediaPipe / Google AI Edge |
| 来源 | [官方 Face Landmarker 模型页](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)；[官方 float16/1 下载文件](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) |
| 可确认版本 | Face Landmarker task bundle `float16/1` |
| 组成模型 | BlazeFace short-range、FaceMesh V2、Blendshape V2 |
| 许可证 | Apache License 2.0；三个官方模型卡均在 License 一节明确声明 Apache License 2.0 |
| 许可证原文 | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)；[MediaPipe LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) |
| 模型卡 | [BlazeFace short-range](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)；[FaceMesh V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)；[Blendshape V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf) |
| SHA-256 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| 本项目修改 | 未修改；仓库文件与上述官方下载文件逐字节一致 |

官方说明将此 task bundle 描述为由上述三个模型组成。模型卡列出的作者分别包括 Google 的 Valentin Bazarevsky（BlazeFace）、Geng Yan 与 Ivan Grishchenko（FaceMesh V2），以及 Ivan Grishchenko、Geng Yan、Andrei Zanfir 与 Eduard Gabriel Bazavan（Blendshape V2）。

## 2. MediaPipe Tasks Vision WebAssembly 运行文件

下列文件来自 npm 包 [`@mediapipe/tasks-vision@1.0.1`](https://registry.npmjs.org/@mediapipe%2ftasks-vision/1.0.1)，用途是运行 Face Landmarker 的 WebAssembly 后端。上游项目为 [Google MediaPipe](https://github.com/google-ai-edge/mediapipe)，包元数据及上游仓库声明 Apache License 2.0。仓库中的文件与该 npm 版本逐字节一致，均未修改。

官方包归档来源：[tasks-vision-1.0.1.tgz](https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.0.1.tgz)。许可证原文见 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 与 [MediaPipe LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)。

| 仓库路径 | SHA-256 |
|---|---|
| `public/wasm/vision_wasm_internal.js` | `e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73` |
| `public/wasm/vision_wasm_internal.wasm` | `8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886` |
| `public/wasm/vision_wasm_module_internal.js` | `da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d` |
| `public/wasm/vision_wasm_module_internal.wasm` | `2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b` |
| `public/wasm/vision_wasm_nosimd_internal.js` | `e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658` |
| `public/wasm/vision_wasm_nosimd_internal.wasm` | `a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192` |

## 3. Next.js starter SVG 图标

`public/file.svg`、`public/globe.svg` 和 `public/window.svg` 的图形内容来自 Vercel Next.js `create-next-app` starter。上游采用 MIT License。仓库文件的图形内容未修改；与上游固定提交相比仅缺少文件末尾换行。

- 上游项目：[vercel/next.js](https://github.com/vercel/next.js)
- 固定来源提交：[`086294e2e5bee8352d69929ba5772e4d3863bba9`](https://github.com/vercel/next.js/tree/086294e2e5bee8352d69929ba5772e4d3863bba9/packages/create-next-app/templates/app/js/public)
- 许可证：[Next.js MIT License](https://github.com/vercel/next.js/blob/086294e2e5bee8352d69929ba5772e4d3863bba9/license.md)

| 仓库路径 | SHA-256 |
|---|---|
| `public/file.svg` | `1e0ae4d1a1ddfa36752988647b731e4abf150c414d069ec83c96fb0aaeff0307` |
| `public/globe.svg` | `d051a8c47936990a9085693d307bb7cea1bc1b6d7ed956bcbaacf674f4ec96b9` |
| `public/window.svg` | `decf1cf7bb22b5c99c4857cfcd5718ce5465c4454166317589c83fc73df74b66` |

## 4. OpenAI Sites starter 与生成资产

这些资产没有被声明为开源第三方包，也不由项目 MIT License 自动覆盖。其使用与再分发依据 OpenAI 条款及适用法律：

- [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/)
- [ChatGPT Sites Terms](https://openai.com/policies/chatgpt-sites-terms/)

| 仓库路径 | 来源与用途 | 版本/证据 | SHA-256 | 本项目修改 |
|---|---|---|---|---|
| `public/favicon.svg` | OpenAI Sites Vinext starter 的站点图标 | Sites starter `0.1.32`；与该版本 starter 文件逐字节一致 | `e6d2e59b7b5bbb0342e0fb496dfc262decbfe4426bbb7b047aec8d467d1dc6f7` | 未修改 |
| `public/joystorm-card-rain-fireworks.png` | JoyStorm AR 首页雨水与烟花插画，由 OpenAI 图像生成服务生成 | 文件内 C2PA 声明 `gpt-image 2.0`、OpenAI Media Service API，创建时间 `2026-08-30` | `4343025e3c407eb3968ebd0222654774892d4f34f61558609e0a3cfec5cf7a60` | 作为项目专用生成资产使用 |

ChatGPT Sites Terms 第 1.1 节说明，网站中包含的代码、软件与材料在用户和 OpenAI 之间属于用户的 Content，用户保留所有权；Terms of Use 的 Content 条款同时适用。上述条款不代表 OpenAI 对第三方权利作出保证，也不授予 OpenAI 商标许可。

## 5. 直接生产依赖

以下版本来自当前 `package-lock.json` 的实际解析结果。完整传递依赖清单及版本以 `package-lock.json` 为准；每个包仍适用其随附许可证与 notice 文件。

| npm 包 | 锁定版本 | 用途 | 许可证 | 上游 |
|---|---:|---|---|---|
| `@mediapipe/tasks-vision` | `1.0.1` | Face Landmarker Web API 与运行时 | Apache-2.0 | [MediaPipe](https://github.com/google-ai-edge/mediapipe) |
| `drizzle-orm` | `0.45.2` | Sites starter 保留的 ORM 依赖；当前 AR 主流程未调用数据库 | Apache-2.0 | [drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| `next` | `16.3.3` | React 应用框架兼容层 | MIT | [Next.js](https://github.com/vercel/next.js) |
| `react` | `19.2.6` | 用户界面运行时 | MIT | [React](https://github.com/facebook/react) |
| `react-dom` | `19.2.6` | 浏览器 DOM 渲染 | MIT | [React](https://github.com/facebook/react) |

开发依赖与传递依赖没有在此逐项复制。复核时可结合 `package.json`、`package-lock.json`、`node_modules/<package>/LICENSE*` 和对应上游发行信息检查。

## 6. 商标与许可边界

MediaPipe、Google、OpenAI、ChatGPT、Next.js、Vercel、React 及其他名称和标识可能是各自权利人的商标。许可证允许的代码或文件使用不等同于获得商标许可、背书或关联关系。若重新分发本仓库，应保留适用的版权、许可证与本 notices 文件。
