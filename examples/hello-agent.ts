/**
 * 示例：用 Proteus SDK + DeepSeek 创建一个能读写文件的 Agent
 *
 * 运行：
 *   DEEPSEEK_API_KEY=sk-xxx npx tsx examples/hello-agent.ts
 */
import { ProteusSDK } from "../packages/sdk/src/sdk.js";
import { createDeepSeekProvider, WriteFileTool, ReadFileTool, ListDirTool } from "../packages/core/src/index.js";

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("请设置环境变量 DEEPSEEK_API_KEY");
    process.exit(1);
  }

  // 1. 创建 SDK 实例（接入 DeepSeek）
  const llm = createDeepSeekProvider({ apiKey });
  const sdk = new ProteusSDK({ llm });

  // 2. 注册工具
  sdk.registerTool(new WriteFileTool());
  sdk.registerTool(new ReadFileTool());
  sdk.registerTool(new ListDirTool());

  // 3. 创建会话
  sdk.createSession("demo", {
    sessionId: "demo",
    llm: { provider: "deepseek", model: "deepseek-chat", temperature: 0 },
    tools: { write_file: true, read_file: true, list_dir: true },
    logLevel: "info",
  });

  // 4. 发送消息
  console.log("用户: 在当前目录创建 hello.txt，内容是 'hello world'\n");
  const result = await sdk.chat("demo", "在当前目录创建 hello.txt，内容是 'hello world'");

  console.log("状态:", result.status);
  console.log("Turn ID:", result.turnId);

  // 5. 查看回复
  const messages = sdk.getMessages("demo");
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant");
  console.log("\nAgent 回复:", lastReply?.content);
}

main().catch(console.error);
