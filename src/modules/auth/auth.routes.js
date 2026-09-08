/**
 * auth.routes.js — 认证模块路由层
 *
 * 职责：
 *   - 声明认证模块的 HTTP 接口地图
 *   - 每个接口调用 controller 处理，不写逻辑
 *
 * 模块遵循"4 层分离"：
 *   routes → controller → service → repo
 */
import { AuthController } from './auth.controller.js'

export function authRoutes() {
  const controller = new AuthController()

  return [
    {
      method: 'POST',
      path: '/api/auth/login',
      handler: (req, res) => controller.login(req, res),
    },
    {
      method: 'POST',
      path: '/api/auth/register',
      handler: (req, res) => controller.register(req, res),
    },
    // 活跃成员列表（供共享选择，所有登录用户可访问）
    {
      method: 'GET',
      path: '/api/users',
      handler: (req, res) => controller.listActiveUsers(req, res),
    },
    // 管理员用户管理
    {
      method: 'GET',
      path: '/api/admin/users',
      handler: (req, res) => controller.listUsers(req, res),
    },
    {
      method: 'PATCH',
      path: '/api/admin/users/:username',
      handler: (req, res) => controller.updateUser(req, res),
    },
    {
      method: 'POST',
      path: '/api/admin/users/:username/reset-password',
      handler: (req, res) => controller.resetPassword(req, res),
    },
  ]
}