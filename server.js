/**
 * server.js — 入口层（Entry Point / Bootstrap）
 *
 * 职责：
 *   - 程序启动的唯一入口
 *   - 启动时做"应用装配"，然后监听端口
 *   - 负责优雅退出（SIGINT/SIGTERM）
 *   - 初始化 SQLite、默认 admin、旧数据迁移
 *
 * 运行方式：
 *   node server.js
 *   或：npm start
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './src/config.js'
import { buildApp } from './src/app.js'
import { AuthService } from './src/modules/auth/auth.service.js'
import { FileRepo } from './src/modules/files/files.repo.js'
import { getDb, closeDb } from './src/utils/sqlite.js'
import { logger } from './src/utils/logger.js'

// 项目根目录（用于 PID 文件定位）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '.')
const PID_FILE = path.join(ROOT, 'data', 'server.pid')

// 初始化 SQLite 数据库（建表）
getDb()

// 迁移旧 JSON 数据（若存在）
await migrateLegacyData()

// 初始化默认 admin 账号（若不存在）
await ensureDefaultAdmin()

// 清理孤儿元数据（兼容旧版本"文件只存内存"导致的重启丢失）
await new FileRepo().cleanupOrphans()

// 确保存储目录存在（幂等）
const app = await buildApp()

const server = createServer((req, res) => app.handle(req, res))

// 启动监听
server.listen(config.port, config.host, () => {
  // 写入 PID 文件，供 stop.bat 精确定位进程
  try {
    writeFileSync(PID_FILE, String(process.pid), 'utf8')
  } catch (err) {
    logger.warn(`写入 PID 文件失败: ${err.message}`)
  }
  console.log('==============================================')
  console.log('  脚本仙人  小组脚本共享系统')
  console.log(`  服务地址:  http://${config.host}:${config.port}`)
  console.log(`  前端页面:  http://${config.host}:${config.port}/`)
  console.log('  演示账号:  admin / Pys1486069942')
  console.log('  退出:      Ctrl + C')
  console.log('==============================================')
})

// 优雅退出：收到中断信号时，先关闭服务器再退出进程
function shutdown() {
  console.log('\n正在关闭服务...')
  server.close(() => {
    closeDb() // 关闭数据库
    // 清理 PID 文件
    try {
      rmSync(PID_FILE, { force: true })
    } catch (err) {
      logger.warn(`清理 PID 文件失败: ${err.message}`)
    }
    console.log('服务已安全关闭')
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

/** 确保默认 admin 账号存在（首次启动时创建） */
async function ensureDefaultAdmin() {
  try {
    const authService = new AuthService()
    const existing = authService.repo.findByUsername('admin')
    if (!existing) {
      await authService.register('admin', 'Pys1486069942')
      await authService.repo.updateUser('admin', { role: 'admin' })
      logger.info('已创建默认 admin 账号')
    }
  } catch (err) {
    logger.warn(`初始化 admin 账号失败: ${err.message}`)
  }
}

/** 迁移旧 JSON 数据（users.json / meta.json）到 SQLite */
async function migrateLegacyData() {
  const { existsSync, readFileSync } = await import('node:fs')
  const { queryOne, run } = await import('./src/utils/sqlite.js')

  // 迁移用户
  const usersFile = config.usersFile
  if (existsSync(usersFile)) {
    try {
      const users = JSON.parse(readFileSync(usersFile, 'utf8'))
      if (Array.isArray(users) && users.length > 0) {
        let migrated = 0
        for (const u of users) {
          if (!queryOne('SELECT 1 FROM users WHERE username = ?', u.username)) {
            run(
              'INSERT INTO users (username, passwordHash, role, status, createdAt, failCount, lockedUntil) VALUES (?, ?, ?, ?, ?, ?, ?)',
              u.username,
              u.passwordHash,
              u.role || 'user',
              u.status || 'active',
              u.createdAt || new Date().toISOString(),
              u.failCount || 0,
              u.lockedUntil || null
            )
            migrated++
          }
        }
        if (migrated > 0) logger.info(`已从 JSON 迁移 ${migrated} 个用户`)
      }
    } catch (err) {
      logger.warn(`迁移用户数据失败: ${err.message}`)
    }
  }

  // 迁移文件元数据（旧版文件本体在 uploads/{id}，无版本）
  const metaFile = config.metaFile
  if (existsSync(metaFile)) {
    try {
      const files = JSON.parse(readFileSync(metaFile, 'utf8'))
      if (Array.isArray(files) && files.length > 0) {
        let migrated = 0
        for (const f of files) {
          if (!queryOne('SELECT 1 FROM files WHERE id = ?', f.id)) {
            // 旧版文件本体在 uploads/{id}（无版本目录），迁移为 v1
            const oldPath = `${config.uploadDir}/${f.id}`
            if (existsSync(oldPath)) {
              const { mkdir, copyFile } = await import('node:fs/promises')
              const newDir = `${config.uploadDir}/${f.id}`
              await mkdir(newDir, { recursive: true })
              await copyFile(oldPath, `${newDir}/v1`)
            }
            run(
              `INSERT INTO files (id, owner, name, size, contentType, currentVersion, isPublic, sharedWith, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, 1, 0, '[]', ?, ?)`,
              f.id,
              f.owner,
              f.name,
              f.size,
              f.contentType || 'application/octet-stream',
              f.createdAt || new Date().toISOString(),
              f.createdAt || new Date().toISOString()
            )
            run(
              `INSERT INTO file_versions (id, fileId, version, size, updatedBy, changeNote, createdAt)
               VALUES (?, ?, 1, ?, ?, '初始版本', ?)`,
              randomUUID(),
              f.id,
              f.size,
              f.owner,
              f.createdAt || new Date().toISOString()
            )
            migrated++
          }
        }
        if (migrated > 0) logger.info(`已从 JSON 迁移 ${migrated} 个文件`)
      }
    } catch (err) {
      logger.warn(`迁移文件数据失败: ${err.message}`)
    }
  }
}