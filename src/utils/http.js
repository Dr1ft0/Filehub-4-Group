/**
 * utils/http.js — HTTP 公共工具
 *
 * 职责：
 *   - 统一 JSON 响应（成功/失败）
 *   - 读取并解析 JSON 请求体（带大小限制）
 *   - 定义业务错误类型（AppError），供全局错误边界识别
 *
 * 设计说明：
 *   - 所有 controller 通过这里的 sendJSON / sendError 输出响应，保证格式一致
 *   - AppError 携带 HTTP 状态码，Service 层抛出后由全局错误边界统一处理
 */
import { config } from '../config.js'

/** 业务错误：携带 HTTP 状态码，供全局错误边界识别 */
export class AppError extends Error {
  constructor(status, message, code = 'FAILED') {
    super(message)
    this.status = status
    this.code = code
    this.name = 'AppError'
  }
}

/** 统一成功响应 */
export function sendJSON(res, status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** 统一失败响应 */
export function sendError(res, status, message, code = 'FAILED') {
  sendJSON(res, status, { error: code, message })
}

/** 读取并解析 JSON 请求体（带大小上限，防止恶意超大 body） */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let tooLarge = false

    req.on('data', (chunk) => {
      if (data.length > config.maxBodySize) {
        tooLarge = true
        req.destroy()
        return
      }
      data += chunk
    })

    req.on('end', () => {
      if (tooLarge) {
        reject(new AppError(413, '请求体过大', 'PAYLOAD_TOO_LARGE'))
        return
      }
      if (!data) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new AppError(400, '请求体不是合法 JSON', 'INVALID_JSON'))
      }
    })

    req.on('error', () => {
      reject(new AppError(400, '读取请求体失败', 'BODY_READ_ERROR'))
    })
  })
}