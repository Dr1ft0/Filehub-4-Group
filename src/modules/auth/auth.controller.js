/**
 * auth.controller.js — 认证模块控制器层
 *
 * 职责：
 *   - 解析 HTTP 请求（读 body、取参数）
 *   - 调用 service 层执行业务
 *   - 把结果/异常转成 HTTP 响应
 *
 * 设计说明：
 *   - 不写业务规则，只做 HTTP 语义转换
 *   - 依赖注入 service，便于测试
 */
import { AuthService } from './auth.service.js'
import { readJson, sendJSON, sendError } from '../../utils/http.js'

export class AuthController {
  constructor(service = new AuthService()) {
    this.service = service
  }

  /** POST /api/auth/login */
  async login(req, res) {
    try {
      const body = await readJson(req)
      const result = await this.service.login(body?.username, body?.password)
      sendJSON(res, 200, result)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** POST /api/auth/register */
  async register(req, res) {
    try {
      const body = await readJson(req)
      const result = await this.service.register(body?.username, body?.password)
      sendJSON(res, 201, result)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  // ---------- 管理员用户管理 ----------

  /** GET /api/admin/users */
  async listUsers(req, res) {
    try {
      const users = this.service.listUsers()
      sendJSON(res, 200, users)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** GET /api/users — 活跃成员列表（供共享选择，所有登录用户可访问） */
  async listActiveUsers(req, res) {
    try {
      const users = this.service.listActiveUsers()
      sendJSON(res, 200, users)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** PATCH /api/admin/users/:username — 禁用/启用/改角色 */
  async updateUser(req, res) {
    try {
      const body = await readJson(req)
      const username = req.params.username
      let result = null
      if (body?.status) {
        result = await this.service.setUserStatus(username, body.status)
      }
      if (body?.role) {
        result = await this.service.setUserRole(username, body.role)
      }
      sendJSON(res, 200, result)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** POST /api/admin/users/:username/reset-password */
  async resetPassword(req, res) {
    try {
      const body = await readJson(req)
      const result = await this.service.resetPassword(req.params.username, body?.newPassword)
      sendJSON(res, 200, result)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }
}