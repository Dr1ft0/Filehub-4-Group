/**
 * middleware/auth.js — 鉴权中间件（Authentication Middleware）
 *
 * 职责：
 *   - 对 /api/* 请求做"身份验证"：检查请求头里的 Bearer token
 *   - 通过：把用户信息挂到 req.user 上，放行
 *   - 失败：直接返回 401，不进入业务
 *
 * 这是简化版的 JWT —— 用"HMAC 签名"验证 token 真实性，
 * 避免引入依赖库，同时演示"签名-校验"的鉴权原理。
 *
 * 增强点：
 *   - token 携带 iat（签发时间）和 exp（过期时间）
 *   - 校验时检查是否过期
 *
 * 注：生产环境请使用成熟库（jsonwebtoken / fastify-jwt）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

// ---------- 工具：签发/校验 token ----------
export function signToken(payload, { secret = config.secret, ttl = config.tokenTtl } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const full = {
    ...payload,
    iat: now,
    exp: now + ttl,
  }
  const body = Buffer.from(JSON.stringify(full)).toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyToken(token, { secret = config.secret } = {}) {
  try {
    const [body, sig] = token.split('.')
    const expectSig = createHmac('sha256', secret).update(body).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expectSig)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))

    // 校验过期时间
    if (payload.exp && Date.now() / 1000 > payload.exp) return null

    return payload
  } catch {
    return null // token 格式损坏 → 视为无效
  }
}

// ---------- 中间件 ----------
export async function middleware(req, res) {
  const auth = req.headers['authorization']
  if (!auth || !auth.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: '缺少 token，请先登录' }))
    return false // 用 false 表示"已拦截"
  }
  const user = verifyToken(auth.slice('Bearer '.length))
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'token 无效或已过期' }))
    return false
  }
  req.user = user // 后续业务可用 req.user.username/role
  return true
}