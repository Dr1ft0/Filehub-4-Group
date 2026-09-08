/**
 * app.js — 应用装配层（Application Composition Root）
 *
 * 职责：
 *   - 创建"路由表"：把 URL 路径映射到对应模块的处理函数
 *   - 注册中间件（鉴权）
 *   - 全局错误边界：捕获所有 handler 异常，返回统一错误响应
 *   - 请求日志
 *   - 暴露唯一的 handle(req, res) 给 HTTP server 调用
 *
 * 这是"控制反转(loC)"思想的体现：
 *   服务器(server.js)不知道具体业务，只调用 app.handle；
 *   app 在这里把各个模块"装配"起来。
 */
import { middleware } from './middleware/auth.js'
import { healthRoutes } from './modules/health/health.routes.js'
import { filesRoutes } from './modules/files/files.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { serveStatic } from './utils/static.js'
import { sendJSON, sendError } from './utils/http.js'
import { logger } from './utils/logger.js'

// 无需登录即可访问的公共路径
const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
])

export async function buildApp() {
  const routes = [
    ...healthRoutes(),
    ...authRoutes(),
    ...filesRoutes(),
  ]

  return {
    async handle(req, res) {
      const start = Date.now()
      const url = new URL(req.url, `http://${req.headers.host}`)
      const method = req.method?.toUpperCase()
      const path = url.pathname

      try {
        // API 请求
        if (path.startsWith('/api')) {
          // 非公共路径，先做鉴权
          if (!PUBLIC_API_PATHS.has(path)) {
            const passed = await middleware(req, res)
            if (!passed) {
              logger.request(method, path, 401, Date.now() - start)
              return // 已拦截（401）
            }
          }

          // 管理员接口：仅 admin 角色可访问
          if (path.startsWith('/api/admin') && req.user?.role !== 'admin') {
            sendError(res, 403, '需要管理员权限', 'FORBIDDEN')
            logger.request(method, path, 403, Date.now() - start)
            return
          }

          const route = matchRoute(routes, method, path)
          if (!route) {
            sendError(res, 404, '接口不存在', 'NOT_FOUND')
            logger.request(method, path, 404, Date.now() - start)
            return
          }
          req.params = route.params ?? {}
          await route.handler(req, res, url)
          logger.request(method, path, res.statusCode ?? 200, Date.now() - start)
          return
        }

        // 静态资源（前端演示页）
        await serveStatic(req, res, path)
        logger.request(method, path, res.statusCode ?? 200, Date.now() - start)
      } catch (err) {
        // 全局错误边界：任何未捕获异常都转成 500，避免进程崩溃
        logger.error(`[app] 未捕获异常: ${err.stack || err.message}`)
        if (!res.headersSent) {
          sendError(res, 500, '服务器内部错误', 'INTERNAL_ERROR')
        } else {
          res.destroy()
        }
        logger.request(method, path, 500, Date.now() - start)
      }
    },

    sendJSON,
  }
}

/** 匹配路由：支持 /api/files/:id 动态段 */
export function matchRoute(routes, method, path) {
  const segments = path.split('/').filter(Boolean)
  for (const r of routes) {
    if (r.method !== method) continue
    const rSegments = r.path.split('/').filter(Boolean)
    if (rSegments.length !== segments.length) continue
    const params = {}
    let ok = true
    for (let i = 0; i < rSegments.length; i++) {
      if (rSegments[i].startsWith(':')) {
        params[rSegments[i].slice(1)] = decodeURIComponent(segments[i])
      } else if (rSegments[i] !== segments[i]) {
        ok = false
        break
      }
    }
    if (ok) return { ...r, params }
  }
  return null
}