# 脚本仙人 — 小组脚本共享系统（脚本共享 + 版本管理）

一个面向**小组内网协作**的文件/脚本共享系统，重点展示**严谨的分层架构**与**工程化落地**。
纯 Node.js 原生实现，**零 npm 依赖**，`node server.js` 即可运行，不依赖 esbuild / vite / 编译工具，避开公司安全软件对 esbuild 的拦截。

> 核心定位：**共享脚本 + 脚本版本管理**。支持多版本、历史查看、回滚、更新说明，适合小组内共享部署脚本、工具脚本、配置文件等。

---

## 一、如何运行

```bash
# 进入项目目录
cd filehub-demo

# 启动（推荐，Node 24+，需支持 node:sqlite）
node server.js

# 或（带文件修改自动重启）
node --watch server.js
```

启动后浏览器打开：**http://127.0.0.1:3000/**
同事通过 **http://10.26.55.125:3000/**打开

**演示账号：** admin / 123456（首次启动自动创建）

### 内网小组部署（后台常驻）

```bash
# 启动（后台运行，监听 0.0.0.0，小组内网可访问）
start.bat

# 停止
stop.bat

# 备份 data/ 目录（数据库 + 文件 + 日志）
backup.bat
```

> 默认监听 `0.0.0.0`，小组内网成员通过 `http://<服务器IP>:3000/` 访问。
> 仅本机调试可设 `HOST=127.0.0.1`。

---

## 二、功能演示（已实现）

### 认证与用户
| 操作 | 说明 |
|---|---|
| 登录 | 签发带过期时间的 token，连续失败锁定账号 |
| 注册 | 新用户注册，密码 scrypt 哈希存储 |
| 用户管理 | 管理员可禁用/启用用户、改角色、重置密码 |

### 文件 / 脚本管理
| 操作 | 说明 |
|---|---|
| 上传 | 支持文本/脚本（JSON）和任意文件（multipart/form-data） |
| 下载 | 流式下载，正确文件名和 MIME |
| 在线预览 | 文本类文件直接预览 |
| 搜索 | 按文件名模糊搜索 |
| 重命名 | 修改文件名 |
| 删除 | 删除文件（含所有版本） |

### 脚本版本管理（核心）
| 操作 | 说明 |
|---|---|
| 新增版本 | 为脚本添加新版本，可填更新说明 |
| 版本历史 | 查看所有版本（版本号/大小/更新人/时间/说明） |
| 查看版本 | 查看任意历史版本内容 |
| 回滚 | 一键回滚到指定版本（直接切换当前版本指针，保留全部历史） |

### 小组共享
| 操作 | 说明 |
|---|---|
| 共享给成员 | 指定用户名列表，共享给特定成员 |
| 小组公共 | 设为公共文件，所有人可见 |
| 权限控制 | 只有 owner 能改/删/共享；可读用户能下载/预览/看版本 |

### 运维
| 操作 | 说明 |
|---|---|
| 健康检查 | `GET /api/health` 返回状态、磁盘、文件数、用户数 |
| 审计日志 | 上传/下载/删除/版本/共享等操作记录到 SQLite + audit.log |
| 运行日志 | 按天滚动落盘到 data/logs/ |
| 备份 | backup.bat 一键备份 data/ 目录 |

---

## 三、架构设计（核心）

严格分层：**Router(路由) → Controller(控制器) → Service(业务) → Repo(数据)**

```
请求进入
   │
   ▼
server.js                 ★ 入口层：启动、装配、优雅退出、初始化、数据迁移
   │
   ▼
app.js                    ★ 装配层：注册路由表 + 中间件 + 全局错误边界 + 管理员校验
   │
 　├── middleware/auth.js   ★ 中间件：Bearer token 鉴权（HMAC 签名 + 过期校验）
   │
   ▼
modules/<name>/
   ├── *.routes.js        ★ 路由层：声明接口地图（method+path→handler）
   ├── *.controller.js    ★ 控制器层：解析 HTTP 请求/响应，不写业务
   ├── *.service.js       ★ 服务层：业务规则校验，编排数据
   └── *.repo.js          ★ 数据层：封装存储（SQLite + 磁盘文件）
   │
   ▼
utils/                    ★ 工具层：http / logger / password / sqlite / audit / multipart / static
```

### 各层职责（一图看懂）

| 层 | 文件 | 职责 | 类比 |
|---|---|---|---|
| 入口层 | `server.js` | 启动、监听、优雅退出、初始化、数据迁移 | 大门 |
| 装配层 | `app.js` | 组装所有模块、注册路由、全局错误边界 | 前台调度 |
| 中间件 | `middleware/auth.js` | 请求身份校验 | 门卫 |
| 路由层 | `*.routes.js` | 接口地图（who→what） | 菜单 |
| 控制器层 | `*.controller.js` | 解析 req/res，转 HTTP 语义 | 服务员 |
| 服务层 | `*.service.js` | 业务规则、编排 | 厨师 |
| 数据层 | `*.repo.js` | 读写存储 | 仓库 |
| 工具层 | `utils/*.js` | 公共设施（HTTP/日志/密码/存储/审计） | 公共设施 |

### 依赖方向

```
Controller → Service → Repo（依赖向下）
上层只依赖下层的接口，下层不认识上层。
→ 换存储(Repo)或换框架(Controller)不影响其他层。
```

---

## 四、目录结构

```
filehub-demo/
├── server.js                 # 入口（启动/迁移/优雅退出）
├── package.json              # 项目身份（纯 ESM）
├── start.bat                 # 后台启动脚本（内网部署）
├── stop.bat                  # 停止脚本
├── backup.bat                # 备份脚本
├── public/
│   └── index.html            # 前端演示页（原生 JS，无构建）
├── data/
│   ├── filehub.db            # SQLite 数据库（用户/文件/版本/审计）
│   ├── audit.log             # 审计日志
│   ├── logs/                 # 运行日志（按天滚动）
│   └── uploads/              # 文件本体（按 uploads/{id}/v{version} 存多版本）
└── src/
    ├── app.js                # 应用装配 + 全局错误边界 + 管理员校验
    ├── config.js             # 配置层（含环境校验）
    ├── middleware/
    │   └── auth.js           # 鉴权中间件 + token 签名工具
    ├── modules/
    │   ├── health/           # 健康检查（无需鉴权）
    │   │   ├── health.routes.js
    │   │   └── health.service.js
    │   ├── auth/             # 认证（登录/注册/用户管理，4 层结构）
    │   │   ├── auth.routes.js
    │   │   ├── auth.controller.js
    │   │   ├── auth.service.js
    │   │   └── auth.repo.js
    │   └── files/            # 文件管理（核心 4 层演示）
    │       ├── files.routes.js
    │       ├── files.controller.js
    │       ├── files.service.js
    │       └── files.repo.js
    └── utils/
        ├── http.js           # 统一响应 + readJson + AppError
        ├── logger.js         # 结构化日志（按天滚动落盘）
        ├── password.js       # scrypt 密码哈希
        ├── sqlite.js         # node:sqlite 封装 + 建表 + 事务
        ├── audit.js          # 审计日志
        ├── multipart.js      # multipart/form-data 解析（零依赖）
        └── static.js         # 静态资源服务
```

---

## 五、用到的架构思想（面试/学习点）

| 思想 | 体现 |
|---|---|
| **分层架构** | Controller/Service/Repo 职责分离 |
| **控制反转(IoC)** | server 只调 app.handle，不碰业务 |
| **单一职责(SRP)** | 每个文件只做一件事 |
| **依赖倒置** | 上层依赖下层接口，不依赖实现 |
| **开闭原则** | 加新模块只需在 app.js 注册，不改核心 |
| **防御性编程** | 路径穿越校验、body 大小限制、token 防篡改 |
| **元数据与文件分离** | 元数据在 SQLite，本体在 uploads 目录 |
| **全局错误边界** | 所有异常统一转 500，不崩溃进程 |
| **事务一致性** | 元数据 + 版本记录用 SQLite 事务保证原子性 |
| **数据迁移** | 旧 JSON 数据启动时自动迁移到 SQLite |

---

## 六、安全增强

| 项目 | 说明 |
|---|---|
| 密码存储 | scrypt 加盐哈希，绝不存明文 |
| token 过期 | 带 iat/exp，过期自动失效 |
| 登录防护 | 连续失败锁定账号，防暴力破解 |
| 用户体系 | 多用户 + 角色（admin/user）+ 禁用状态 |
| 权限控制 | owner 才能改/删/共享；可读用户才能下载/预览 |
| 路径穿越 | path.relative 严谨校验 |
| 错误处理 | 统一 500 响应，不崩溃进程 |
| 文件 I/O | 异步 fs/promises |
| 列表 | 分页 + 搜索 |

---

## 七、Demo 与生产的差距（诚实说明）

| 演示用 | 生产应该用 |
|---|---|
| SQLite（node:sqlite） | PostgreSQL / MySQL |
| 磁盘存文件 | 对象存储 MinIO/S3 |
| HMAC 手写 token | jsonwebtoken / fastify-jwt |
| scrypt 手写哈希 | bcrypt / argon2 |
| 单机内存 | 分布式 + 负载均衡 + 监控 |
| 无 HTTPS | 内网也建议 HTTPS（或 VPN） |

---

## 八、接口速查

```
# 认证
POST /api/auth/login        body: {username, password}  → {token, username, role}
POST /api/auth/register     body: {username, password}  → {username, role}

# 健康检查（无需 token）
GET  /api/health            返回状态、磁盘、文件数、用户数

# 文件
GET  /api/files?page=1&pageSize=20&q=关键词   列出可访问文件（分页+搜索）
POST /api/files             上传文件，支持两种方式：
                            - JSON:  body: {name, content}（文本/脚本）
                            - multipart/form-data: 字段 file（任意二进制文件）
GET  /api/files/download/:id 下载当前版本（流式）
PATCH /api/files/:id         body: {name}  重命名
DELETE /api/files/:id       删除文件（含所有版本）

# 版本管理
POST /api/files/:id/versions        body: {content, changeNote}  新增版本
GET  /api/files/:id/versions        版本历史
GET  /api/files/:id/versions/:version  查看指定版本内容
POST /api/files/:id/versions/:version/restore  回滚到指定版本

# 共享
POST /api/files/:id/share    body: {usernames: []}  设置共享人
POST /api/files/:id/public   body: {isPublic: bool}  设置公共/取消公共

# 管理员用户管理
GET  /api/admin/users        列出所有用户
PATCH /api/admin/users/:username  body: {status|role}  禁用/启用/改角色
POST /api/admin/users/:username/reset-password  body: {newPassword}  重置密码
```

---

## 九、环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 3000 | 服务端口 |
| `HOST` | 0.0.0.0 | 监听地址（内网小组访问） |
| `SECRET` | demo-secret-change-me | token 签名密钥（生产必改） |
| `TOKEN_TTL` | 86400 | token 有效期（秒） |
| `MAX_FILE_SIZE` | 5242880 | 单文件上限（字节） |
| `MAX_BODY_SIZE` | 6291456 | 请求体上限（字节） |
| `PAGE_SIZE` | 20 | 列表分页大小 |
| `LOGIN_MAX_ATTEMPTS` | 5 | 登录失败锁定阈值 |
| `LOGIN_LOCK_SECONDS` | 300 | 锁定时间（秒） |
| `UPLOAD_DIR` | data/uploads | 文件本体目录 |
| `DB_FILE` | data/filehub.db | SQLite 数据库文件 |
| `AUDIT_FILE` | data/audit.log | 审计日志文件 |
| `LOG_DIR` | data/logs | 运行日志目录 |