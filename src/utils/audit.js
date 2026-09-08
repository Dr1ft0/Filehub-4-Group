/**
 * utils/audit.js — 操作审计工具
 *
 * 职责：
 *   - 记录用户操作（上传/下载/删除/共享/版本/登录等）
 *   - 写入 SQLite audit_logs 表 + 追加到 audit.log 文件
 *
 * 设计说明：
 *   - 审计不阻塞主流程（异步写入）
 *   - 同时落库和落文件，便于查询和追溯
 */
import { appendFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { run } from './sqlite.js'
import { logger } from './logger.js'

/**
 * 记录审计日志
 * @param {string} username 操作者
 * @param {string} action 操作类型
 * @param {string} [target] 操作对象（如文件 id/name）
 * @param {string} [detail] 详情
 */
export function audit(username, action, target = '', detail = '') {
  const createdAt = new Date().toISOString()

  // 写入 SQLite（异步，不阻塞）
  try {
    run(
      'INSERT INTO audit_logs (username, action, target, detail, createdAt) VALUES (?, ?, ?, ?, ?)',
      username || 'anonymous',
      action,
      target,
      detail,
      createdAt
    )
  } catch (err) {
    logger.warn(`[audit] 写入数据库失败: ${err.message}`)
  }

  // 追加到文件（异步）
  try {
    mkdirSync(path.dirname(config.auditFile), { recursive: true })
    const line = `[${createdAt}] [${username || 'anonymous'}] [${action}] ${target} ${detail}\n`
    appendFile(config.auditFile, line, 'utf8').catch((err) => {
      logger.warn(`[audit] 写入文件失败: ${err.message}`)
    })
  } catch (err) {
    logger.warn(`[audit] 初始化审计文件失败: ${err.message}`)
  }
}