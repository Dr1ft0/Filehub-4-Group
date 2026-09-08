/**
 * utils/sqlite.js — SQLite 存储封装（零依赖，Node 原生 node:sqlite）
 *
 * 职责：
 *   - 初始化 SQLite 数据库，创建所有表
 *   - 提供通用的查询/插入/更新/删除方法
 *   - 供用户、文件、版本、审计等模块复用
 *
 * 设计说明：
 *   - 使用 node:sqlite 的 DatabaseSync（Node 22.5+，Node 24 稳定）
 *   - 单例模式：整个应用共享一个数据库连接
 *   - 表结构：
 *     - users: 用户
 *     - files: 文件元数据（含共享、公共、当前版本）
 *     - file_versions: 文件版本历史
 *     - audit_logs: 操作审计
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { logger } from './logger.js'

let _db = null

/** 获取数据库单例 */
export function getDb() {
  if (_db) return _db

  // 确保 data 目录存在
  mkdirSync(path.dirname(config.dbFile), { recursive: true })

  _db = new DatabaseSync(config.dbFile)
  _db.exec('PRAGMA journal_mode = WAL;') // 并发读写优化
  _db.exec('PRAGMA foreign_keys = ON;')

  initSchema(_db)
  logger.info(`[SQLite] 数据库已初始化: ${config.dbFile}`)
  return _db
}

/** 初始化表结构 */
function initSchema(db) {
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      username     TEXT PRIMARY KEY,
      passwordHash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'user',
      status       TEXT NOT NULL DEFAULT 'active',  -- active | disabled
      createdAt    TEXT NOT NULL,
      failCount    INTEGER NOT NULL DEFAULT 0,
      lockedUntil  TEXT
    );

    -- 文件元数据表
    CREATE TABLE IF NOT EXISTS files (
      id             TEXT PRIMARY KEY,
      owner          TEXT NOT NULL,
      name           TEXT NOT NULL,
      size           INTEGER NOT NULL,
      contentType    TEXT NOT NULL DEFAULT 'application/octet-stream',
      currentVersion INTEGER NOT NULL DEFAULT 1,
      isPublic       INTEGER NOT NULL DEFAULT 0,   -- 0 | 1
      sharedWith     TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
      description    TEXT,                          -- 文件简介（可空）
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL,
      FOREIGN KEY (owner) REFERENCES users(username)
    );

    -- 文件版本表
    CREATE TABLE IF NOT EXISTS file_versions (
      id         TEXT PRIMARY KEY,
      fileId     TEXT NOT NULL,
      version    INTEGER NOT NULL,
      size       INTEGER NOT NULL,
      updatedBy  TEXT NOT NULL,
      changeNote TEXT,
      createdAt  TEXT NOT NULL,
      UNIQUE(fileId, version),
      FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE
    );

    -- 审计日志表
    CREATE TABLE IF NOT EXISTS audit_logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT,
      action    TEXT NOT NULL,   -- upload | download | delete | share | version | login | ...
      target    TEXT,
      detail    TEXT,
      createdAt TEXT NOT NULL
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_versions_file ON file_versions(fileId);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(createdAt);
  `)

  // 迁移：为已存在的 files 表补充 description 字段（老库升级）
  migrateSchema(db)
}

/**
 * 增量迁移：老版本数据库可能缺少新字段，这里用 ALTER TABLE 补齐。
 * 通过 PRAGMA table_info 检查列是否存在，避免重复添加报错。
 */
function migrateSchema(db) {
  const cols = db.prepare('PRAGMA table_info(files)').all()
  const hasDescription = cols.some((c) => c.name === 'description')
  if (!hasDescription) {
    db.exec('ALTER TABLE files ADD COLUMN description TEXT')
    logger.info('[SQLite] 已为 files 表新增 description 字段')
  }
}

/** 关闭数据库（优雅退出时调用） */
export function closeDb() {
  if (_db) {
    _db.close()
    _db = null
  }
}

/** 通用查询：返回所有行 */
export function queryAll(sql, ...params) {
  const db = getDb()
  return db.prepare(sql).all(...params)
}

/** 通用查询：返回单行 */
export function queryOne(sql, ...params) {
  const db = getDb()
  return db.prepare(sql).get(...params) ?? null
}

/** 通用执行：插入/更新/删除，返回 lastInsertRowid / changes */
export function run(sql, ...params) {
  const db = getDb()
  return db.prepare(sql).run(...params)
}

/** 事务执行 */
export function transaction(fn) {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const result = fn(db)
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}