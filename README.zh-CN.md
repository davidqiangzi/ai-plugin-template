[🇬🇧 English](README.md) | [🇨🇳 中文简体](README.zh-CN.md)

## 概述

这是一个 Figma AI 插件模板，展示了如何在 Figma 插件中进行 LLM 流式响应，并可以通过提示词直接生成 UI 设计稿。本模板演示了：

- 在服务端安全地配置 OpenAI 密钥和代理地址
- 将 GPT 生成的 JSON 结构流式传输到前端 iframe
- 在 Figma 画布上实时将 JSON 渲染为原生图层（Frame、Text、Rectangle 等）
- 包含 Tailwind 和 Next.js 的全功能 React iframe 界面
- 将你的插件部署到生产环境
- 从 iframe 中直接调用 Figma 原生 API

## 快速开始

本项目基于 [Next.js](https://nextjs.org/) 构建。

首先安装依赖：

\`\`\`bash
npm install
\`\`\`

接下来，你需要在根目录下创建一个 \`.env\` 文件，并存入你的 API Key 和接口地址：

\`\`\`bash
OPENAI_API_KEY=sk-your-token
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
\`\`\`

然后，运行本地开发服务器：

\`\`\`bash
npm run dev
\`\`\`

启动后，打开 Figma 桌面端应用，并在画布上右键选择 \`Plugins > Development > Import plugin from manifest...\`，然后选择本项目下的 \`plugin/manifest.json\` 文件即可导入插件。

## 编辑此模板

你可以通过编辑以下核心文件来定制你的功能：

- \`app/page.tsx\`: 插件的 \`iframe\` 前端界面。当你修改此文件时页面会自动热更新，你可以在这里设计插件的 UI 并编写将 JSON 转换为图层的逻辑。
- \`app/api/completion/route.ts\`: 插件的“后端”，负责与 OpenAI 通信。你可以在这里修改发送给 GPT 的系统提示词 (System Prompt)。
- \`plugin/manifest.json\`: 这是插件的 [配置文件](https://www.figma.com/plugin-docs/manifest/)，你可以在此修改插件的权限、名称和支持的编辑器类型。

## 发布你的插件

在本示例中，我们可以将 Next.js 应用发布到 [Vercel](https://vercel.com/)。你也可以发布到任何支持 Next.js 的托管平台。

1. 将代码推送到 GitHub。
2. 在 Vercel 上创建账号并绑定你的 GitHub。
3. 部署你的应用到 Vercel。
4. 部署时，确保在环境变量设置中添加你的 \`OPENAI_API_KEY\` 和 \`OPENAI_BASE_URL\`。
5. 部署成功后，将 \`package.json\` 文件中的 \`siteURL\` 更新为你部署后的线上地址（例如 \`https://your-site-here.vercel.app/\`）。

\`\`\`json
"config": {
  "siteURL": "https://your-site-here.vercel.app/"
}
\`\`\`

6. 运行 \`npm run build\` 为你的插件打包生产环境的 \`code.js\`。
7. 在本地测试你的插件，确保指向 Vercel 线上地址后功能依然正常。
8. [将插件发布到社区](https://help.figma.com/hc/en-us/articles/360042293394-Publish-plugins-to-the-Figma-Community)
9. 发布到社区后，只要你推送到 GitHub，你的插件 iframe 就会自动更新（无需重新审核）。

## figmaAPI 辅助函数

本模板在 \`@/lib/figmaAPI\` 中提供了一个 \`figmaAPI\` 辅助函数，它允许你直接在 iframe 的 React 代码中运行沙盒代码。
这省去了在 iframe 和 plugin 沙盒之间反复编写 \`postMessage\` 的麻烦。

**示例:**

\`\`\`ts
import { figmaAPI } from "@/lib/figmaAPI";

const nodeId = "0:2";

const result = await figmaAPI.run(
  (figma, { nodeId }) => {
    return figma.getNodeById(nodeId)?.name;
  },
  // 你想传递给沙盒内函数的任何外部变量，都必须作为第二个参数传入。
  { nodeId },
);

console.log(result); // "Page 1"
\`\`\`

## 了解更多

- [Next.js 文档](https://nextjs.org/docs) - 了解 Next.js 特性和 API。
- [Figma 插件 API](https://www.figma.com/plugin-docs/) - 了解 Figma 插件开发。
- [OpenAI API](https://platform.openai.com/docs/guides/gpt) - 了解 GPT 接口。
