# DeepSeek Desktop

**中文** · [English](README.en.md)

专为 **DeepSeek** 打造的桌面客户端 + 编码 Agent —— 流式对话,加上完整的内置 Agent
(读写文件、执行命令、内置终端、MCP 工具、Office 文档等)。主要面向 DeepSeek API,但也
**兼容任何 OpenAI 兼容接口**(在设置里改 Base URL 即可)。

> 不是 Electron:用极小的 **C++ / Win32 / WebView2** 原生壳承载 **React + Vite + TypeScript**
> 前端,Bun 构建。启动快、内存低。Windows 10/11。

---

## 功能

**对话**
- 逐字 **流式输出**,走原生 `http.stream` 命令(WinHTTP 工作线程 + 按行切分的 SSE),
  绕过 CORS,也不会 UTF‑8 截断。
- DeepSeek V 系列模型,推理过程(`reasoning_content`)以可折叠块展示。
- Markdown + 代码高亮、消息队列、超长对话自动 **上下文压缩**。

**Agent**
- 工具:读取/列目录/查找/搜索文件、`edit_file` / `write_file`、`run_command`、常驻
  **进程**(PTY 会话)、`web_search` / `read_url`、读取 Office。
- **审批模式**(对齐 Codex):*只读* / *自动* / *完全访问*,可按工具细调,界面内审批栏确认。
- **计划** 与 **目标** 模式;实时 **计划 / 待办** 面板。
- **MCP 服务器**(HTTP)接入外部工具。
- **子代理** —— 把一个独立子任务交给自主的嵌套 Agent,只回传一段摘要,保持主线程干净。
- **检查点 + 一键回滚** —— 每轮自动快照改动的文件,可一键还原 Agent 的修改。

**Office 与文档**
- 纯前端生成 **Word(.docx)**、**Excel(.xlsx)**(支持真公式)、**PowerPoint(.pptx)**
  —— 包括 **Morph 动画演示**(docx / pptxgenjs / SheetJS)。
- 应用内 **Office 预览**(表格渲染、Word 用 mammoth、幻灯片卡片)。
- 内置 **文档技能**:融资路演、财务模型、数据仪表盘、3D 网页演示、报告、学术论文 ——
  通过 `/技能` 斜杠命令注入领域知识。

**工作区**
- **预览面板**:本地网页 + Office 文件,实时刷新。
- **内置终端** —— 真正的 **ConPTY** 伪控制台,用 xterm.js 渲染(提示符、颜色、全屏程序)。
- 可调宽侧边栏、命令面板(Ctrl+K)、Projects/Chats 分组、@ 提及文件、自定义斜杠命令、
  中英双语、深/浅色主题、界面缩放(Ctrl ±)、系统托盘、快捷键速查(Ctrl+/)。

---

## 快速开始

**环境要求:** Windows 10/11 · [Bun](https://bun.sh) · Visual Studio 2022 生成工具(C++ 桌面)
· WebView2 运行时(Win10/11 通常已内置)。

```bash
bun install
bun run setup     # 一次性:下载 WebView2 SDK + nlohmann/json 到 deps/
bun run dev       # 热重载开发(Vite + 原生壳)
# 或
bun run build     # → dist\app.exe
```

启动后点 **⚙ 设置**,填入 DeepSeek API Key(在 platform.deepseek.com 获取),并可选地
设置一个工作目录给 Agent 使用。

### 构建变体

```bash
bun run build:single     # 单文件自包含 exe(HTML/JS/CSS 全内嵌)
bun run package:single   # 可分发 zip
```

---

## 安全与隐私

- **API Key 只存在本机**(WebView2 用户数据目录下的 `localStorage`),不会提交进仓库,
  也只会发往你自己配置的接口。
- Agent 的文件/命令工具在 **你的机器上** 运行;默认审批模式是 *只读*,改文件/跑命令都会
  先询问,除非你切到 自动/完全访问。

---

## 项目结构

```
native/main.cpp     C++ WebView2 壳(新增 http.stream 流式 + ConPTY pty.* 命令)
src/api.ts          原生命令的 TS 封装
src/lib/            deepseek.ts(流式客户端)· useChat.ts(回合循环、工具、审批、
                    子代理、检查点)· tools.ts · office.ts · skills.ts · storage.ts
src/components/     TitleBar / Sidebar / ChatView / Message / PreviewPanel / TerminalPanel /
                    Settings / Composer / CommandPalette / ShortcutsPanel …
scripts/            setup / dev / build / package(Bun)
```

---

## ☕ 支持作者

如果这个项目对你有帮助,欢迎请我喝杯咖啡,非常感谢 ❤️

- ⭐ 给个 Star：<https://github.com/kobolingfeng/deepseek-desktop>
- 💳 PayPal：<https://paypal.me/koboling>
- 💚 微信赞赏：

<img src="assets/wechat-reward.jpg" alt="微信赞赏码" width="220">

---

## 许可

[MIT](LICENSE)。基于 强强(QiangQiang)原生壳框架构建。
