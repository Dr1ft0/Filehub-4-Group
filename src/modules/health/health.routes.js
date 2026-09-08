/**
 * health.routes.js — 路由层（接口定义）
 *
 * 职责：
 *   - 只声明"有哪些接口、谁来处理"，不写业务逻辑
 *   - 返回路由定义数组，由装配层统一注册
 */
import { HealthService } from './health.service.js'

export function healthRoutes() {
  const service = new HealthService()

  return [
    {
      method: 'GET',
      path: '/api/health',
      handler: async (req, res) => {
        const data = await service.check()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(data))
      },
    },
  ]
}