/**
 * auth.service.js — 认证模块服务层
 *
 * 职责：
 *   - 登录：校验用户名密码、处理失败锁定、签发 token
 *   - 注册：创建新用户（密码哈希存储）
 *   - 业务规则校验，不直接碰 HTTP
 *
 * 设计说明：
 *   - 密码用 scrypt 哈希，绝不存明文
 *   - 连续失败达到阈值后锁定账号一段时间，防暴力破解
 *   - 依赖注入 repo，便于测试和替换存储
 */
import { AuthRepo } from './auth.repo.js'
import { hashPassword, verifyPassword } from '../../utils/password.js'
import { signToken } from '../../middleware/auth.js'
import { AppError } from '../../utils/http.js'
import { config } from '../../config.js'

export class AuthService {
  constructor(repo = new AuthRepo()) {
    this.repo = repo
  }

  /** 登录：成功返回 { token, username, role } */
  async login(username, password) {
    if (!username || !password) {
      throw new AppError(400, '用户名和密码不能为空', 'INVALID_INPUT')
    }

    const user = this.repo.findByUsername(username)

    // 用户不存在：统一返回"用户名或密码错误"，避免暴露用户是否存在
    if (!user) {
      throw new AppError(401, '用户名或密码错误', 'LOGIN_FAILED')
    }

    // 检查用户是否被禁用
    if (user.status === 'disabled') {
      throw new AppError(403, '账号已被禁用，请联系管理员', 'ACCOUNT_DISABLED')
    }

    // 检查是否被锁定
    if (user.lockedUntil && Date.now() < new Date(user.lockedUntil).getTime()) {
      const remainSec = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000)
      throw new AppError(423, `账号已锁定，请 ${remainSec} 秒后重试`, 'ACCOUNT_LOCKED')
    }

    // 校验密码
    if (!verifyPassword(password, user.passwordHash)) {
      // 失败计数 +1
      const failCount = (user.failCount || 0) + 1
      let lockedUntil = null
      if (failCount >= config.loginMaxAttempts) {
        lockedUntil = new Date(Date.now() + config.loginLockSeconds * 1000).toISOString()
      }
      await this.repo.updateUser(username, { failCount, lockedUntil })
      throw new AppError(401, '用户名或密码错误', 'LOGIN_FAILED')
    }

    // 登录成功：重置失败计数
    if (user.failCount || user.lockedUntil) {
      await this.repo.updateUser(username, { failCount: 0, lockedUntil: null })
    }

    // 签发 token（含过期时间）
    const token = signToken({ username, role: user.role })
    return { token, username, role: user.role }
  }

  /** 注册新用户 */
  async register(username, password) {
    if (!username || !password) {
      throw new AppError(400, '用户名和密码不能为空', 'INVALID_INPUT')
    }
    if (username.length < 3 || username.length > 32) {
      throw new AppError(400, '用户名长度需在 3-32 个字符之间', 'INVALID_INPUT')
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new AppError(400, '用户名只能包含字母、数字和下划线', 'INVALID_INPUT')
    }
    if (password.length < 6) {
      throw new AppError(400, '密码长度至少 6 位', 'INVALID_INPUT')
    }

    // 检查用户名是否已存在
    if (this.repo.findByUsername(username)) {
      throw new AppError(409, '用户名已存在', 'USER_EXISTS')
    }

    const passwordHash = hashPassword(password)
    const user = await this.repo.createUser({ username, passwordHash, role: 'user' })
    return { username: user.username, role: user.role }
  }

  // ---------- 管理员用户管理 ----------

  /** 列出所有用户（管理员） */
  listUsers() {
    return this.repo.listAll()
  }

  /** 列出所有活跃用户（供共享选择，普通用户可访问） */
  listActiveUsers() {
    return this.repo.listActive()
  }

  /** 禁用/启用用户 */
  async setUserStatus(username, status) {
    if (status !== 'active' && status !== 'disabled') {
      throw new AppError(400, '非法状态', 'INVALID_INPUT')
    }
    const user = this.repo.findByUsername(username)
    if (!user) throw new AppError(404, '用户不存在', 'NOT_FOUND')
    if (user.role === 'admin' && status === 'disabled') {
      throw new AppError(400, '不能禁用管理员账号', 'INVALID_OPERATION')
    }
    await this.repo.updateUser(username, { status })
    return { username, status }
  }

  /** 修改用户角色 */
  async setUserRole(username, role) {
    if (role !== 'admin' && role !== 'user') {
      throw new AppError(400, '非法角色', 'INVALID_INPUT')
    }
    const user = this.repo.findByUsername(username)
    if (!user) throw new AppError(404, '用户不存在', 'NOT_FOUND')
    await this.repo.updateUser(username, { role })
    return { username, role }
  }

  /** 重置用户密码 */
  async resetPassword(username, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      throw new AppError(400, '新密码长度至少 6 位', 'INVALID_INPUT')
    }
    const user = this.repo.findByUsername(username)
    if (!user) throw new AppError(404, '用户不存在', 'NOT_FOUND')
    const passwordHash = hashPassword(newPassword)
    await this.repo.updateUser(username, { passwordHash, failCount: 0, lockedUntil: null })
    return { username }
  }
}