import assert from "node:assert/strict";
import test from "node:test";

test("renders the JoyStorm product shell", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, /<title>JoyStorm AR<\/title>/i);
  assert.match(html, /lang="zh-CN"/i);
  assert.match(html, /你的笑容能带来温柔的细雨与灿烂的烟花/);
  assert.match(html, /开启摄像头体验/);
  assert.match(html, /中性状态/);
  assert.match(html, /微笑状态/);
  assert.match(html, /大笑状态/);
  assert.doesNotMatch(html, /模拟中性状态/);
  assert.match(html, /不代表真人表情识别结果/);
  assert.doesNotMatch(html, /class="behavior-row"/);
  assert.doesNotMatch(html, /class="performance-row"/);
  assert.doesNotMatch(html, /Your expression controls the weather/i);
});
