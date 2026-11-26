import { createDemoApp } from "../../backend/demo/workspace.js";
import { startLocalPreview } from "./local-preview.mjs";

const server = await startLocalPreview(createDemoApp(), 5182);
console.log("田水智联 · 本地演示模式（内存数据库，重启还原）");
server.printUrls();
