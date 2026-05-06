# userbank-gateway

UserBank 统一服务端入口网关。面向前端提供统一 API，是 UserBank 体系长期对外的主入口；当前版本实现 LLM 对话与知识库文件接入。

## 功能概览

- `POST /chat`：接收对话消息 → 调用下游 `userbank-rag-core` 准备 prompt / context → 调用 LLM 生成回答 → 返回 JSON 或 SSE 流
- `POST /knowledge/files`：上传知识库文件 → 存入 MinIO → 通知 `userbank-rag-core` 创建索引任务
- `GET /knowledge/index-jobs/:job_id`：查询 Python RAG 上游索引任务状态
- `GET /health`：健康检查
- 预留扩展点：鉴权、多租户

## 技术栈

- Node.js ≥ 20.11
- TypeScript（严格模式 + `@/` 路径别名）
- Fastify v5（高性能、原生 TS 友好、对流式扩展友好）
- Zod + `@fastify/type-provider-zod`（请求/响应同源 Schema 校验与类型推导）
- better-sse（面向前端的 Server-Sent Events）
- @fastify/multipart（知识库文件上传）
- MinIO SDK（对象存储）
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
│   ├── knowledge.ts        # 知识库上传 / 索引任务响应
│   └── common.ts           # Citation / Usage / Error
├── routes/
│   ├── chat.ts             # POST /chat
│   ├── knowledge.ts        # POST /knowledge/files / GET /knowledge/index-jobs/:job_id
│   └── health.ts           # GET /health
├── services/
│   ├── chatService.ts      # 业务编排：prepare prompt → llm
│   └── promptService.ts    # Prompt 组装（context 截断、引用顺序对齐）
├── providers/
│   └── llm/
│       ├── types.ts        # LlmProvider 抽象
│       ├── openaiProvider.ts # OpenAI 兼容实现
│       └── index.ts        # Provider 工厂
├── clients/
│   ├── ragCoreClient.ts    # userbank-rag-core HTTP 客户端
│   └── minioClient.ts      # MinIO 对象存储客户端
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
| `RAG_CORE_CHAT_PREPARE_PATH` | 否 | RAG 上游准备 prompt 的路径，默认 `/chat/prepare` |
| `RAG_CORE_INDEX_JOBS_PATH` | 否 | RAG 上游索引任务路径，默认 `/index-jobs` |
| `LLM_PROVIDER` | 否 | 目前仅支持 `openai` |
| `LLM_BASE_URL` | 是 | OpenAI 兼容服务的 base url |
| `LLM_API_KEY` | 是 | LLM API Key |
| `LLM_MODEL` | 是 | 模型名（如 `gpt-4o-mini`） |
| `LLM_TEMPERATURE` | 否 | 默认 `0.2` |
| `LLM_MAX_TOKENS` | 否 | 默认 `1024` |
| `PROMPT_MAX_CONTEXT_CHARS` | 否 | 进入 prompt 的 context 最大字符数，默认 `6000` |
| `MINIO_ENDPOINT` | 是 | MinIO endpoint，不含协议 |
| `MINIO_PORT` | 否 | MinIO 端口，默认 `9000` |
| `MINIO_ACCESS_KEY` | 是 | MinIO Access Key |
| `MINIO_SECRET_KEY` | 是 | MinIO Secret Key |
| `MINIO_BUCKET` | 否 | 知识库文件 bucket，默认 `userbank-knowledge` |
| `MINIO_USE_SSL` | 否 | 是否使用 HTTPS，默认 `false` |
| `MINIO_REGION` | 否 | MinIO region |
| `UPLOAD_MAX_FILE_SIZE_MB` | 否 | 单文件上传大小上限，默认 `50` |
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
- `stream=true` 返回 `text/event-stream`，由 gateway 调用 LLM 上游的 OpenAI-compatible streaming API 后通过 `better-sse` 转发给前端。

SSE 事件：

- `citations`：`{ "citations": Citation[] }`
- `token`：`{ "content": string }`
- `usage`：`{ "usage": { "prompt_tokens": number, "completion_tokens": number } }`
- `done`：`{ "ok": true }`
- `error`：`{ "message": string }`

### `POST /knowledge/files`

请求：`multipart/form-data`

字段：

- `file`：必填，知识库原文件。
- `collection_id`：可选，默认 `default`。

响应：

```json
{
  "file_id": "9d2c3d8a-2bd1-4a08-b10f-c9a4f51c8a75",
  "object_key": "knowledge/default/9d2c3d8a-2bd1-4a08-b10f-c9a4f51c8a75/intro.pdf",
  "bucket": "userbank-knowledge",
  "index_job_id": "job_001",
  "status": "queued"
}
```

Gateway 只负责接收文件、写入 MinIO，并通知 Python RAG 上游创建索引任务；文件解析、切分、embedding 与 PG 索引写入由 Python RAG 上游完成。

### `GET /knowledge/index-jobs/:job_id`

响应：

```json
{
  "job_id": "job_001",
  "status": "processing",
  "file_id": "9d2c3d8a-2bd1-4a08-b10f-c9a4f51c8a75",
  "collection_id": "default",
  "object_key": "knowledge/default/9d2c3d8a-2bd1-4a08-b10f-c9a4f51c8a75/intro.pdf"
}
```

### `GET /health`

响应：

```json
{ "status": "ok" }
```

## 下游契约：`userbank-rag-core`

Gateway 默认使用如下契约调用 Python RAG 上游（可在 `src/clients/ragCoreClient.ts` 中调整）：

- `POST {RAG_CORE_BASE_URL}{RAG_CORE_CHAT_PREPARE_PATH}`
  - 默认路径：`/chat/prepare`
  - 请求体：`{ "messages": ChatMessage[], "collection_id": string, "top_k": number, "max_context_chars": number }`
  - 响应体：`{ "messages": ChatMessage[], "citations": Citation[] }`
  - 用途：由 Python RAG 侧检索知识库并返回新的 prompt/messages，LLM 调用仍由 gateway 完成。
- `POST {RAG_CORE_BASE_URL}{RAG_CORE_INDEX_JOBS_PATH}`
  - 默认路径：`/index-jobs`
  - 请求体：`{ "file_id": string, "collection_id": string, "bucket": string, "object_key": string, "filename": string, "content_type": string, "size_bytes": number }`
  - 响应体：`{ "job_id": string, "status": "queued" | "processing" | "completed" | "failed" }`
  - 用途：文件已进入 MinIO 后，通知 Python RAG 上游解析、切分、embedding，并写入 PG 索引。
- `GET {RAG_CORE_BASE_URL}{RAG_CORE_INDEX_JOBS_PATH}/{job_id}`
  - 响应体：`{ "job_id": string, "status": "queued" | "processing" | "completed" | "failed", ... }`
  - 用途：查询索引任务状态。
- `POST {RAG_CORE_BASE_URL}/retrieve`
  - 请求体：`{ "query": string, "collection_id": string, "top_k": number }`
  - 响应体：`{ "chunks": Citation[] }`
  - 用途：兼容当前检索契约。当 `/chat/prepare` 返回 404 时，gateway 会回退到该接口并在本地组装 prompt。

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
| `OBJECT_STORAGE_ERROR` | 502 | MinIO 不可达 / bucket 创建失败 / 文件写入失败 |
| `NOT_FOUND` | 404 | 路由不存在 |
| `INTERNAL_ERROR` | 500 | 其他未捕获异常 |

## 扩展点（路线图）

- 鉴权：新增 `src/plugins/auth.ts`，由 `AUTH_ENABLED` 控制注册；在请求上下文挂载 `tenantId / userId`。
- 多租户：在 RAG 调用与 prompt 中带上租户隔离参数（如 `collection_id` 命名空间、ACL 过滤）。
- 多 LLM Provider：在 `src/providers/llm/` 下新增实现并在工厂中分发。
