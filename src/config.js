/**
 * config.js — 配置层（Configuration Layer）
 *
 * 职责：
 *   - 集中管理所有运行期参数（端口、路径、密钥、安全策略等）
 *   - 为环境变量提供安全默认值
 *   - 启动时做环境校验，防止生产环境使用弱默认值
 *   - 是本系统"最不常变化的一层"，被其他所有层引用
 *
 * 设计说明：
 *   - 不依赖任何外部库，纯 Node 内置模块
 *   - 路径统一用 fileURLToPath 处理，兼容 Windows
 *   - 生产环境（NODE_ENV=production）会强制校验关键安全配置
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// 当前文件所在目录（src/）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 项目根目录
const ROOT = path.resolve(__dirname, '..')

const isProd = process.env.NODE_ENV === 'production'

// 生产环境默认密钥（仅用于提示，实际必须通过环境变量注入）
const DEFAULT_SECRET = 'demo-secret-change-me'

export const config = {
  // 运行环境
  env: process.env.NODE_ENV ?? 'development',
  isProd,

  // 服务监听端口，允许环境变量覆盖
  port: Number(process.env.PORT ?? 3000),
  // 监听地址：默认 0.0.0.0 允许内网访问（小组协作）
  // 仅本机调试可设 HOST=127.0.0.1
  host: process.env.HOST ?? '0.0.0.0',

  // 鉴权签名密钥：发布 token 用
  // 生产环境务必通过环境变量注入，否则启动会告警
  secret: process.env.SECRET ?? DEFAULT_SECRET,

  // token 有效期（秒），默认 24 小时
  tokenTtl: Number(process.env.TOKEN_TTL ?? 24 * 60 * 60),

  // 文件实际存储目录（文件本体落盘处）
  // 与"元数据存储"分离 —— 这是文件共享系统的核心架构决策
  uploadDir: process.env.UPLOAD_DIR ?? path.join(ROOT, 'data', 'uploads'),

  // SQLite 数据库文件（元数据 + 用户 + 版本 + 审计）
  dbFile: process.env.DB_FILE ?? path.join(ROOT, 'data', 'filehub.db'),

  // 审计日志文件
  auditFile: process.env.AUDIT_FILE ?? path.join(ROOT, 'data', 'audit.log'),

  // 旧版 JSON 数据文件（用于启动时迁移到 SQLite）
  usersFile: process.env.USERS_FILE ?? path.join(ROOT, 'data', 'users.json'),
  metaFile: process.env.META_FILE ?? path.join(ROOT, 'data', 'meta.json'),

  // 运行日志目录（按天滚动）
  logDir: process.env.LOG_DIR ?? path.join(ROOT, 'data', 'logs'),

  // 单文件内容大小上限（字节），默认 5MB
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 5 * 1024 * 1024),

  // 请求体大小上限（字节），默认 6MB（略大于单文件上限）
  maxBodySize: Number(process.env.MAX_BODY_SIZE ?? 6 * 1024 * 1024),

  // 列表分页默认大小
  pageSize: Number(process.env.PAGE_SIZE ?? 20),

  // 登录失败锁定阈值（连续失败次数）
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5),
  // 锁定时间（秒）
  loginLockSeconds: Number(process.env.LOGIN_LOCK_SECONDS ?? 300),
}

// ---------- 启动时环境校验 ----------
// 生产环境：若仍在使用默认密钥，打印强告警
if (isProd && config.secret === DEFAULT_SECRET) {
  console.warn(
    '\n[警告] 生产环境正在使用默认 SECRET！请通过环境变量注入强密钥，例如：\n' +
      '  SECRET="$(openssl rand -hex 32)" node server.js\n'
  )
}

// 校验端口合法性
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error(`[config] 非法端口号: ${config.port}，应为 1-65535 的整数`)
}

// 校验 token 有效期
if (!Number.isFinite(config.tokenTtl) || config.tokenTtl <= 0) {
  throw new Error(`[config] 非法 TOKEN_TTL: ${config.tokenTtl}，应为正数（秒）`)
}