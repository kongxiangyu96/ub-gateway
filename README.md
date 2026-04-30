# userbank-gateway

UserBank 统一服务端入口网关 (MVP)。面向前端提供统一 API，是 UserBank 体系长期对外的主入口；当前版本只实现核心 chat 流程。

## 功能概览

- `POST /chat`：接收对话消息 → 调用下游 `userbank-rag-core` 检索 → 调用 LLM 生成回答 → 返回 `{ answer, citations, usage }`
- `GET /health`：健康检查
- 预留扩展点：流式响应、鉴权、多租户

## 技术栈

- Node.js ≥ 20.11
- TypeScript（严格模式 + `@/` 路径别名）
- Fastify v5（高性能、原生 TS 友好、对流式扩展友好）
- Zod + `@fastify/type-provider-zod`（请求/响应同源 Schema 校验与类型推导）
- Undici（出站 HTTP）
- Pino（日志）

## 目录结构

```
src/
├── app.ts                  # Fastify 应用工厂
├── server.ts               # 进程入口
├── config/
│   └── index.ts            # 环境变量加载与校验
├── schemas/
│   ├── chat.ts             # /chat 请求与响应
│   ├── health.ts           # /health 响应
│   └── common.ts           # Citation / Usage / Error
├── routes/
│   ├── chat.ts             # POST /chat
│   └── health.ts           # GET /health
├── services/
│   ├── chatService.ts      # 业务编排：retrieve → prompt → llm
│   └── promptService.ts    # Prompt 组装（context 截断、引用顺序对齐）
├── providers/
│   └── llm/
│       ├── types.ts        # LlmProvider 抽象
│       ├── openaiProvider.ts # OpenAI 兼容实现
│       └── index.ts        # Provider 工厂
├── clients/
│   └── ragCoreClient.ts    # userbank-rag-core HTTP 客户端
└── plugins/
    └── errorHandler.ts     # 统一错误响应
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 按需修改 LLM_API_KEY / RAG_CORE_BASE_URL 等
```

主要变量：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 监听端口，默认 `8080` |
| `HOST` | 否 | 监听地址，默认 `0.0.0.0` |
| `LOG_LEVEL` | 否 | 日志级别，默认 `info` |
| `RAG_CORE_BASE_URL` | 是 | userbank-rag-core 基础地址 |
| `RAG_CORE_TIMEOUT_MS` | 否 | 检索超时，默认 `15000` |
| `RAG_CORE_TOP_K` | 否 | 检索条数，默认 `5` |
| `LLM_PROVIDER` | 否 | 目前仅支持 `openai` |
| `LLM_BASE_URL` | 是 | OpenAI 兼容服务的 base url |
| `LLM_API_KEY` | 是 | LLM API Key |
| `LLM_MODEL` | 是 | 模型名（如 `gpt-4o-mini`） |
| `LLM_TEMPERATURE` | 否 | 默认 `0.2` |
| `LLM_MAX_TOKENS` | 否 | 默认 `1024` |
| `PROMPT_MAX_CONTEXT_CHARS` | 否 | 进入 prompt 的 context 最大字符数，默认 `6000` |
| `AUTH_ENABLED` | 否 | 鉴权预留开关，MVP 未实现 |

### 3. 启动开发服务

```bash
npm run dev
```

### 4. 构建生产产物

```bash
npm run build
npm start
```

## 接口

### `POST /chat`

请求：

```json
{
  "messages": [
    { "role": "user", "content": "What is UserBank?" }
  ],
  "collection_id": "default",
  "stream": false
}
```

响应：

```json
{
  "answer": "UserBank is ...",
  "citations": [
    {
      "chunk_id": "c_001",
      "document_id": "doc_001",
      "text": "...",
      "score": 0.87,
      "metadata": { "title": "Intro", "page": null }
    }
  ],
  "usage": { "prompt_tokens": 312, "completion_tokens": 187 }
}
```

字段说明：

- `citations` 顺序与 prompt 中 `[#1]`、`[#2]` 的引用顺序一致；超出 `PROMPT_MAX_CONTEXT_CHARS` 的尾部条目会被截断，不会出现在响应中。
- `usage` 来自 LLM 上游，如上游未返回则置 0。
- `stream=true` 在 MVP 暂不支持，后续将走 SSE / NDJSON 扩展。

### `GET /health`

响应：

```json
{ "status": "ok" }
```

## 下游契约：`userbank-rag-core`

Gateway 默认使用如下契约调用下游检索（可在 `src/clients/ragCoreClient.ts` 中调整）：

- `POST {RAG_CORE_BASE_URL}/retrieve`
  - 请求体：`{ "query": string, "collection_id": string, "top_k": number }`
  - 响应体：`{ "chunks": Citation[] }`，其中 `Citation` 字段与 `/chat` 响应中的 citation 完全一致。

## 错误响应

统一格式：

```json
{ "error": { "code": "RAG_CORE_UPSTREAM_ERROR", "message": "..." } }
```

| Code | HTTP | 触发条件 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 请求体校验失败 |
| `RAG_CORE_UPSTREAM_ERROR` | 502 | rag-core 不可达 / 返回非 2xx / 协议不合 |
| `LLM_UPSTREAM_ERROR` | 502 | LLM 服务不可达 / 返回非 2xx / 协议不合 |
| `NOT_FOUND` | 404 | 路由不存在 |
| `INTERNAL_ERROR` | 500 | 其他未捕获异常 |

## 扩展点（路线图）

- 流式响应：在 `chatService` 中新增 `handleStream`，路由层根据 `stream=true` 切换为 SSE/NDJSON。
- 鉴权：新增 `src/plugins/auth.ts`，由 `AUTH_ENABLED` 控制注册；在请求上下文挂载 `tenantId / userId`。
- 多租户：在 RAG 调用与 prompt 中带上租户隔离参数（如 `collection_id` 命名空间、ACL 过滤）。
- 多 LLM Provider：在 `src/providers/llm/` 下新增实现并在工厂中分发。
