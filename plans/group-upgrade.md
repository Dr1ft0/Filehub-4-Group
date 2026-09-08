# FileHub 小组级升级方案

> 目标：将单机演示版升级为小组内网可用的**脚本共享 + 版本管理**系统
> 核心场景：小组内共享脚本，支持在线查看/复制、按语言分类、版本迭代管理
> 约束：保持零依赖、纯 Node 原生（避开公司安全软件对 esbuild 的拦截）

---

## 一、现状与差距

### 当前系统能力（已完成）
- 多用户注册/登录（scrypt 密码哈希、token 过期、登录失败锁定）
- 文件上传（文本 + 任意二进制）、下载、删除、分页
- 文件本体落盘、元数据持久化
- 分层架构、全局错误边界、结构化日志

### 小组级核心差距
| 维度 | 当前 | 小组级需要 |
|---|---|---|
| 网络 | 只监听 127.0.0.1 | 监听内网，小组可访问 |
| 运行 | 前台进程，关终端即停 | 后台常驻、开机自启 |
| 共享 | 只能看自己的文件 | 共享给成员、公共空间 |
| 用户 | 开放注册，无管理 | 管理员禁用/重置密码 |
| 存储 | JSON 文件 | 更可靠（SQLite） |
| 运维 | 控制台日志 | 日志落盘、备份、监控 |

---

## 二、升级方案（按优先级）

### P0：内网访问与常驻运行（小组能用的前提）

**1. 监听内网地址**
- [`config.js`](src/config.js) 的 `host` 默认改为 `0.0.0.0`（或通过环境变量指定内网 IP）
- 小组通过 `http://<服务器内网IP>:3000/` 访问

**2. 后台常驻运行**
- 提供 Windows 启动脚本（`start.bat`），用 `node server.js` 后台运行
- 可选：注册为 Windows 服务（`nssm`）或使用 `pm2`（需引入依赖）
- 提供停止脚本（`stop.bat`）

**3. 内网安全**
- 防火墙只开放 3000 端口
- 可选：自签 HTTPS 证书（Node 原生 `https` 模块）
- 访问日志审计

### P0：文件共享（小组协作核心）

**4. 文件共享模型**
- 每个文件增加 `sharedWith: [username]` 字段（共享给指定成员）
- 增加 `isPublic: boolean` 字段（小组公共空间，所有人可见）
- 权限模型：
  - **owner**：完全控制（读/写/删/共享）
  - **sharedWith 成员**：可读（下载）
  - **公共文件**：所有人可读

**5. 共享接口**
- `POST /api/files/:id/share` — 设置共享人列表
- `POST /api/files/:id/public` — 设为公共/取消公共
- `GET /api/files` — 返回自己的 + 共享给我的 + 公共的

### P0：脚本版本管理（核心）

**6. 版本模型**
- 每个文件（脚本）有多个版本，每次更新保存为新版本
- 文件元数据记录 `currentVersion`（当前版本号）
- 版本表记录：`version`、`content`、`size`、`updatedBy`、`updatedAt`、`changeNote`（更新说明）

**7. 版本接口**
- `POST /api/files/:id/versions` — 上传新版本（body: {content, changeNote}）
- `GET /api/files/:id/versions` — 版本历史列表
- `GET /api/files/:id/versions/:version` — 查看指定版本内容
- `POST /api/files/:id/versions/:version/restore` — 回滚到指定版本
- `GET /api/files/:id/versions/:version/download` — 下载指定版本

**8. 版本存储**
- 文件本体按 `{id}/v{version}` 存盘（如 `uploads/{id}/v1`、`v2`）
- 元数据（版本号、更新人、时间）存 SQLite

### P1：管理员管理用户

**6. 用户管理**
- 管理员可**禁用/启用**用户（禁用后无法登录）
- 管理员可**重置密码**
- 用户增加 `status: 'active' | 'disabled'` 字段
- 注册改为**需管理员审核**（可选）或保持开放但可禁用

**7. 管理接口**
- `GET /api/admin/users` — 用户列表
- `PATCH /api/admin/users/:username` — 禁用/启用/改角色
- `POST /api/admin/users/:username/reset-password` — 重置密码

### P1：存储升级（可选，视数据量）

**8. SQLite 迁移**
- 元数据从 JSON 迁移到 SQLite（单文件、零依赖、支持并发）
- 用 Node 原生 `node:sqlite`（Node 22+）或保持 JSON（数据量小时够用）
- 文件本体仍存磁盘目录

### P2：文件管理增强

**9. 文件操作**
- 重命名：`PATCH /api/files/:id`（改 name）
- 搜索：`GET /api/files?q=关键词`（按文件名模糊搜索）
- 预览：图片/文本在线查看（前端）

### P2：操作审计

**10. 审计日志**
- 记录上传/下载/删除/共享操作
- 落盘到 `data/audit.log`，含时间、用户、操作、文件

### P3：运维完善

**11. 日志落盘**
- 日志同时输出控制台和 `data/logs/` 文件，按天滚动

**12. 备份**
- 提供备份脚本：打包 `data/` 目录（元数据 + 文件 + 用户）

**13. 健康监控**
- `/api/health` 扩展：磁盘空间、文件数、用户数

---

## 三、架构演进

```
当前：单机演示
  server.js → app.js → modules/{auth, files, health} → utils/

升级后：小组内网
  server.js（常驻）→ app.js → modules/
    ├── auth/      登录/注册/用户管理
    ├── files/     文件 CRUD + 共享 + 搜索
    ├── admin/     管理员用户管理
    └── health/    健康监控
  utils/
    ├── http.js    统一响应
    ├── logger.js  日志（落盘）
    ├── password.js 密码哈希
    ├── jsonStore.js / sqlite.js  存储
    ├── multipart.js 文件上传
    └── static.js  静态资源
```

---

## 四、实施顺序建议

1. **P0-内网访问**：改 host、加启动/停止脚本 → 小组能访问
2. **P0-文件共享**：共享模型 + 接口 + 前端 → 小组能协作
3. **P0-版本管理**：版本模型 + 接口 + 前端 → 脚本迭代管理
4. **P1-用户管理**：管理员禁用/重置密码 → 用户治理
5. **P1-SQLite 存储**：元数据迁移到 SQLite → 可靠并发
6. **P2-文件增强**：重命名/搜索/在线预览 → 体验
7. **P2-审计**：操作日志 → 安全
8. **P3-运维**：日志落盘/备份/监控 → 稳定

---

## 五、待确认决策点

1. **存储**：已确认用 Node 原生 `node:sqlite`（零依赖）
2. **注册策略**：开放注册 + 管理员可禁用，还是需管理员审核？
3. **共享粒度**：仅"共享给成员 + 公共空间"，还是需要"文件夹/分组"？
4. **HTTPS**：内网是否需要加密传输？
5. **部署环境**：Windows 服务器？是否有固定内网 IP？
6. **版本管理**：脚本版本是否需要"更新说明"（changeNote）和"回滚"功能？