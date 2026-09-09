# 小组共享代码仓库系统（类 GitHub，支持 Git 协议）规划方案

> 目标：构建一个小组内网可用的**类 GitHub 代码仓库系统**，支持真正的 git 命令（clone/push/pull）
> 核心场景：小组通过 `git clone/push/pull` 协作开发，Web 界面管理仓库、浏览代码、查看提交
> 约束：**全新独立系统**，零依赖、纯 Node 原生，内网部署

---

## 一、核心定位

| 维度 | 说明 |
|---|---|
| 系统形态 | 全新独立系统（不复用「脚本仙人」代码，但沿用其架构经验） |
| 网络 | 内网部署，小组通过局域网访问 |
| Git 支持 | **完整 Git 智能 HTTP 协议**（clone/push/pull/fetch） |
| Web 界面 | 仓库管理、代码浏览、提交历史、分支管理 |
| 技术栈 | 纯 Node.js 零依赖，SQLite 元数据 + 磁盘对象存储 |

---

## 二、Git 协议支持（核心难点）

### 2.1 Git 智能 HTTP 协议

Git 通过 HTTP 提供两种服务，均使用 **pkt-line 编码**：

```
# 获取（fetch/clone）
GET  /{repo}.git/info/refs?service=git-upload-pack
POST /{repo}.git/git-upload-pack

# 推送（push）
GET  /{repo}.git/info/refs?service=git-receive-pack
POST /{repo}.git/git-receive-pack
```

### 2.2 pkt-line 编码
- 每条数据以 4 位十六进制长度前缀开头（如 `001e` = 30 字节）
- `0000` 表示 flush（数据结束）
- 服务端需正确解析和生成 pkt-line

### 2.3 Git 对象模型（需实现）
| 对象 | 说明 | 存储 |
|---|---|---|
| blob | 文件内容 | `objects/xx/yyyy...`（SHA-1 哈希） |
| tree | 目录结构（文件名 → 对象引用） | 同上 |
| commit | 提交（作者/时间/说明/父提交/tree） | 同上 |
| tag | 标签（可选） | 同上 |

### 2.4 packfile 处理（最复杂）
- **push（接收）**：客户端发送 packfile，服务端需**解压 delta**，还原为 loose objects
- **fetch（发送）**：服务端需**生成 packfile**（含 delta 压缩）发送给客户端
- 需实现：zlib 解压/压缩（Node 原生 `zlib`）、delta 指令解析/生成

### 2.5 认证与权限
- HTTP Basic Auth（用户名 + 密码/token）
- 每次 git 操作校验用户权限（读/写）
- 私有仓库：仅 owner + collaborator 可访问
- 公共仓库：小组内可读，仅协作者可写

---

## 三、核心数据模型

### 1. 仓库表 `repos`
```sql
CREATE TABLE IF NOT EXISTS repos (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,          -- 仓库名（如 my-project）
  description TEXT,
  owner       TEXT NOT NULL,
  isPublic    INTEGER NOT NULL DEFAULT 0,
  defaultBranch TEXT NOT NULL DEFAULT 'main',
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL,
  FOREIGN KEY (owner) REFERENCES users(username)
);
```

### 2. 协作者表 `repo_collaborators`
```sql
CREATE TABLE IF NOT EXISTS repo_collaborators (
  repoId   TEXT NOT NULL,
  username TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'write',  -- read | write | admin
  PRIMARY KEY (repoId, username),
  FOREIGN KEY (repoId) REFERENCES repos(id),
  FOREIGN KEY (username) REFERENCES users(username)
);
```

### 3. 仓库磁盘结构（Git 原生格式）
```
data/repos/{repoName}.git/
├── HEAD                    # 指向默认分支（ref: refs/heads/main）
├── config                  # 仓库配置
├── objects/                # Git 对象存储
│   ├── xx/yyyy...          # loose objects（zlib 压缩）
│   └── pack/               # packfile
├── refs/
│   ├── heads/{branch}      # 分支引用（存 commit SHA）
│   └── tags/               # 标签
└── info/refs               # refs 广告缓存
```

> **关键决策**：直接使用 Git 原生磁盘格式（`.git` 目录），这样：
> - 无需自建对象存储，复用 Git 的 loose objects + packfile 机制
> - 元数据（仓库/协作者/用户）存 SQLite，Git 数据存磁盘
> - 与真实 Git 完全兼容

---

## 四、分层架构

```
src/
├── server.js               # 入口
├── config.js               # 配置
├── app.js                  # 路由分发
├── middleware/
│   └── auth.js             # 认证（HTTP Basic + token）
├── modules/
│   ├── auth/               # 用户认证
│   ├── repos/              # 仓库管理（Web API）
│   ├── git/                # Git 协议服务（核心）
│   └── health/             # 健康检查
└── utils/
    ├── sqlite.js           # SQLite 封装
    ├── pktline.js          # pkt-line 编解码
    ├── gitobject.js        # Git 对象读写（loose + packfile）
    ├── packfile.js         # packfile 解析/生成（delta 处理）
    └── logger.js           # 日志
```

### Git 协议模块设计
```
src/modules/git/
├── git.routes.js           # 路由（info/refs, upload-pack, receive-pack）
├── git.controller.js       # HTTP 层（Content-Type 处理）
├── git.service.js          # 业务逻辑（权限校验、协议调度）
└── git.repo.js             # 数据访问（refs、objects、packfile）
```

---

## 五、接口设计

### Web API（管理界面）
```
# 仓库
POST   /api/repos                          # 创建仓库
GET    /api/repos                          # 我的 + 协作者 + 公共仓库
GET    /api/repos/:id                      # 仓库详情
PATCH  /api/repos/:id                      # 修改简介/默认分支
DELETE /api/repos/:id                      # 删除仓库

# 协作者
GET    /api/repos/:id/collaborators
POST   /api/repos/:id/collaborators
DELETE /api/repos/:id/collaborators/:user

# 代码浏览（读取 Git 对象）
GET    /api/repos/:id/tree?branch=main&path=src/   # 目录列表
GET    /api/repos/:id/raw?branch=main&path=src/a.js # 文件内容
GET    /api/repos/:id/commits?branch=main           # 提交历史
GET    /api/repos/:id/commits/:sha                  # 提交详情
GET    /api/repos/:id/branches                      # 分支列表
```

### Git 协议端点
```
GET  /{repo}.git/info/refs?service=git-upload-pack
POST /{repo}.git/git-upload-pack
GET  /{repo}.git/info/refs?service=git-receive-pack
POST /{repo}.git/git-receive-pack
```

---

## 六、分阶段实施计划

### P0：Git 协议核心（最小可用）
- [ ] 数据模型：users / repos / repo_collaborators 建表
- [ ] pkt-line 编解码工具（`utils/pktline.js`）
- [ ] Git 对象读写（loose objects：blob/tree/commit，`utils/gitobject.js`）
- [ ] 仓库创建（初始化 `.git` 目录结构）
- [ ] `git-upload-pack`：实现 clone/fetch（refs 广告 + packfile 生成）
- [ ] `git-receive-pack`：实现 push（接收 packfile + 解压 delta + 更新 refs）
- [ ] HTTP Basic 认证 + 权限校验
- [ ] 测试：`git clone` / `git push` / `git pull` 全流程

### P1：Web 管理界面
- [ ] 仓库 CRUD 界面
- [ ] 代码浏览（目录树 + 文件内容 + 语法高亮）
- [ ] 提交历史展示
- [ ] 分支管理界面
- [ ] 协作者管理界面

### P2：增强功能
- [ ] packfile 优化（fetch 时 delta 压缩，减少传输量）
- [ ] 搜索（仓库名/文件名/提交信息）
- [ ] 操作审计日志
- [ ] 仓库 Fork / Star
- [ ] 大文件限制与提示

---

## 七、关键经验复用（来自「脚本仙人」）

1. **分层架构**：Router → Controller → Service → Repo，功能按固定套路实现
2. **数据与文件分离**：元数据存 SQLite，Git 数据存磁盘
3. **权限集中管理**：`_requireOwner` / `_canRead` 模式，owner 优先 + admin 兜底
4. **边界保护**：删除仓库/分支时校验（不能删默认分支、不能删最后一个提交）
5. **前端数据传递**：**避免在 onclick 内联传复杂 JSON**，只传 id，从数据源读取
6. **SQL 注入防护**：排序/筛选字段白名单校验
7. **路径安全**：仓库名、文件路径严格校验，防路径穿越
8. **Git 版本管理**：每个功能独立 commit，便于回溯

---

## 八、风险与注意事项

| 风险 | 应对 |
|---|---|
| packfile delta 处理复杂 | 先支持无 delta 的简单场景，逐步完善；用 Node 原生 `zlib` |
| 大仓库性能 | 限制单文件/单仓库大小；packfile 分批处理 |
| 并发 push 冲突 | 更新 refs 时校验（乐观锁），冲突返回错误 |
| 认证安全 | HTTP Basic 需配合 HTTPS（内网可先用明文，公网必须 HTTPS） |
| 数据安全 | 定期备份 data/ 目录；审计关键操作 |
| 协议兼容性 | 用真实 git 客户端反复测试 clone/push/pull/fetch |

---

## 九、技术难点详解

### 9.1 packfile 接收（push）
客户端 push 时发送 packfile，包含：
- 头部：`PACK` 魔数 + 版本 + 对象数
- 对象：可能为 **delta 对象**（引用其他对象 + 增量指令）
- 服务端需：解压 zlib → 解析对象 → 应用 delta → 还原完整对象 → 写入 loose objects

### 9.2 packfile 生成（fetch）
服务端 fetch 时需：
- 根据客户端已有的对象（`have`）计算**缺失对象集**
- 生成 packfile（可选 delta 压缩）
- 用 pkt-line 分块发送

### 9.3 refs 广告
`info/refs` 返回所有 refs（分支/标签）及其 commit SHA，格式为 pkt-line：
```
001e<sha> refs/heads/main\0<capabilities>
```

---

## 十、结论

本方案的核心是**实现 Git 智能 HTTP 协议**，让小组能直接用 `git clone/push/pull` 协作。Web 界面作为管理补充。采用 Git 原生磁盘格式（`.git` 目录）可最大化兼容性，避免自建对象存储的复杂度。分阶段实施，P0 先打通 git 命令全流程，P1 再做 Web 界面，P2 增强优化。