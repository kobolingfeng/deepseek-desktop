# DeepSeek Desktop

一个轻量的 DeepSeek 桌面客户端，类似 Claude Desktop —— 流式对话 + 内置 Agent 工具（读写文件、执行命令）。

基于 [**强强 (QiangQiang)**](https://linux.do) 框架构建：C++ Win32 + WebView2 原生壳，前端用 **React + Vite + TypeScript**。无 Electron，启动快、内存低（实测窗口常驻 ~23MB）。

## 特性

- **流式对话** —— token 逐字输出。为此给原生壳新增了 `http.stream` 命令（WinHttp 工作线程 + SSE 按行切分，避免 UTF-8 截断），绕过 CORS，前端用 `http.onStream` 消费。
- **双模型** —— DeepSeek V3（`deepseek-chat`，支持工具）与 DeepSeek R1（`deepseek-reasoner`，展示 `reasoning_content` 思考过程，可折叠）。标题栏一键切换。
- **内置 Agent 工具**（仅 V3）—— `read_file` / `list_dir` / `write_file` / `run_command`。
  - 只读工具（read/list）自动执行；**写文件 / 跑命令需在界面里点「Allow」确认**（可在设置里开「自动批准」跳过）。
  - 多轮工具循环：模型调用工具 → 执行 → 把结果回灌 → 继续，直到给出最终答复（上限 12 轮）。
- **Markdown 渲染** + 代码高亮（highlight.js）+ 一键复制；链接走系统浏览器打开。
- **会话管理** —— 多会话、本地持久化（localStorage，存于 WebView2 用户数据目录）。
- **原生体验** —— 无边框窗口、自定义标题栏（可拖拽）、跟随 Windows 深/浅色与强调色、最小化/最大化/关闭。
- **工作目录** —— 相对路径与命令都在设置里指定的目录下执行。

## 快速开始

### 前置要求

- [Bun](https://bun.sh)（前端构建 + 脚本）
- Visual Studio 2022 Build Tools（C++ 桌面开发，编译原生壳用）
- WebView2 Runtime（Win10/11 一般已内置）

### 安装 & 运行

```bash
bun install
bun run dev        # 热重载开发：Vite + 原生壳，改前端代码即时生效
```

首次会自动编译原生壳。已经 `bun run build` 过的话，`dist\app.exe` 双击即可运行。

### 构建

```bash
bun run build          # 编译前端(Vite) + 原生壳 → dist\app.exe
bun run build:single   # 打包成单 exe（HTML/JS/CSS 全部内嵌）
bun run package:single # 生成可分发 zip
```

### 配置 API Key

启动后点左下角 **⚙ Settings**，填入 DeepSeek API Key（在 platform.deepseek.com 获取）。
Key 只存在本机 localStorage，不会上传。顺手设一下「Working Directory」，工具就在那个目录里干活。

## 项目结构

```
├── native/main.cpp        # C++ WebView2 壳（在强强基础上加了 http.stream / http.streamCancel 流式命令）
├── src/
│   ├── api.ts             # 原生命令的 TS 封装（含新增的 http.stream / onStream）
│   ├── ipc.ts             # IPC 桥
│   ├── App.tsx            # 顶层布局 + 主题
│   ├── main.tsx           # React 入口
│   ├── lib/
│   │   ├── deepseek.ts    # DeepSeek 流式客户端（原生 http.stream，浏览器 fetch 兜底）
│   │   ├── useChat.ts     # 对话状态 + Agent 工具循环 + 审批门
│   │   ├── tools.ts       # 工具 schema + 执行器（fs/shell）
│   │   ├── storage.ts     # 会话/设置持久化
│   │   └── types.ts       # 数据模型
│   ├── components/        # TitleBar / Sidebar / ChatView / Message / Markdown / ToolCallCard / ThinkingBlock / Composer / Settings
│   └── styles/global.css  # 深/浅色主题 + 全部样式
├── scripts/               # 强强构建脚本（setup/dev/build/package）
├── app.config.json        # 窗口配置 + Vite dev/build 命令接入
└── vite.config.ts
```

## 说明

- DeepSeek R1（reasoner）按官方约定**不支持函数调用**，所以选 R1 时自动禁用工具，只做带思考过程的对话。
- 原生 `http.stream` 在工作线程跑 WinHttp，通过 `PostMessage(WM_USER+3)` 把 SSE 数据回灌到 UI 线程再 `ipc_emit`，不阻塞界面；按 `\n` 边界切分保证每段都是合法 UTF-8。

构建于强强框架（MIT）。
