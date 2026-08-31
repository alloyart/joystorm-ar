import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const copySource = await readFile(new URL("../app/zh-CN.ts", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("首页卡片只保留新主文案与细雨烟花插画", () => {
  assert.match(copySource, /你的笑容能带来温柔的细雨与灿烂的烟花/);
  assert.doesNotMatch(pageSource, /className="behavior-row"/);
  assert.match(stylesSource, /joystorm-card-rain-fireworks\.png/);
});

test("摄像头启动反馈包含三个阶段和四类错误", () => {
  for (const message of [
    "正在请求摄像头权限",
    "正在加载人脸识别模型",
    "请尽情的绽放你的笑容吧",
    "用户拒绝权限",
    "当前设备没有摄像头",
    "浏览器不支持",
    "模型加载失败",
  ]) {
    assert.match(copySource, new RegExp(message));
  }
  assert.match(pageSource, /NotAllowedError/);
  assert.match(pageSource, /NotFoundError/);
  assert.match(pageSource, /modelLoadFailed/);
});

test("运行性能区域不再渲染三枚说明标签", () => {
  assert.doesNotMatch(pageSource, /className="performance-row"/);
});

test("效果测试使用简洁状态文案并在操作栏复用插画", () => {
  assert.match(copySource, /neutral: "中性状态"/);
  assert.match(copySource, /smile: "微笑状态"/);
  assert.match(copySource, /laugh: "大笑状态"/);
  assert.match(stylesSource, /\.control-rail::after/);
  assert.match(stylesSource, /opacity: 0\.24/);
});
