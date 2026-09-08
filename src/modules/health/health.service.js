/**
 * health.service.js — 服务层（应用层）
 *
 * 职责：
 *   - 健康检查业务：返回服务状态、时间、版本
 *   - 监控信息：磁盘空间、文件数、用户数
 *
 * 注意：健康检查通常不需要鉴权（K8s/LB 探针要用）。
 *       所以这个模块的路由没有挂鉴权中间件。
 */
import { statfsSync } from 'node:fs'
import { config } from '../../config.js'
import { queryOne } from '../../utils/sqlite.js'

export class HealthService {
  constructor() {
    this.startedAt = new Date()
  }

  check() {
    // 磁盘空间
    let disk = null
    try {
      const s = statfsSync(config.uploadDir)
      disk = {
        totalBytes: s.blocks * s.bsize,
        freeBytes: s.bavail * s.bsize,
      }
    } catch {
      disk = null
    }

    // 文件数、用户数
    let fileCount = 0
    let userCount = 0
    try {
      fileCount = queryOne('SELECT COUNT(*) as cnt FROM files').cnt
      userCount = queryOne('SELECT COUNT(*) as cnt FROM users').cnt
    } catch {
      // 数据库未初始化时忽略
    }

    return {
      status: 'ok',
      service: 'filehub-demo',
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      timestamp: new Date().toISOString(),
      stats: {
        fileCount,
        userCount,
        disk,
      },
    }
  }
}