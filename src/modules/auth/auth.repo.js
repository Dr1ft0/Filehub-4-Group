/**
 * auth.repo.js — 认证模块数据层
 *
 * 职责：
 *   - 封装用户数据的读写（基于 SQLite）
 *   - 提供按用户名查找、创建用户、更新登录状态等方法
 *   - 支持用户状态管理（active/disabled）
 *
 * 设计说明：
 *   - 用户密码以 scrypt 哈希存储，绝不存明文
 *   - 登录失败计数/锁定时间持久化，重启后仍生效
 */
import { queryOne, queryAll, run } from '../../utils/sqlite.js'

export class AuthRepo {
  /** 按用户名查找用户 */
  findByUsername(username) {
    return queryOne('SELECT * FROM users WHERE username = ?', username)
  }

  /** 创建用户（密码已由 service 层哈希） */
  createUser({ username, passwordHash, role = 'user' }) {
    run(
      'INSERT INTO users (username, passwordHash, role, status, createdAt, failCount, lockedUntil) VALUES (?, ?, ?, ?, ?, 0, NULL)',
      username,
      passwordHash,
      role,
      'active',
      new Date().toISOString()
    )
    return this.findByUsername(username)
  }

  /** 更新用户（用于登录失败计数、锁定、状态等） */
  updateUser(username, patch) {
    const allowed = ['passwordHash', 'role', 'status', 'failCount', 'lockedUntil']
    const sets = []
    const params = []
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        sets.push(`${key} = ?`)
        params.push(patch[key])
      }
    }
    if (sets.length === 0) return this.findByUsername(username)
    params.push(username)
    run(`UPDATE users SET ${sets.join(', ')} WHERE username = ?`, ...params)
    return this.findByUsername(username)
  }

  /** 列出所有用户（管理员用） */
  listAll() {
    return queryAll('SELECT username, role, status, createdAt, failCount FROM users ORDER BY createdAt')
  }

  /** 列出所有活跃用户（供共享选择，普通用户可访问） */
  listActive() {
    return queryAll("SELECT username, role FROM users WHERE status = 'active' ORDER BY createdAt")
  }
}