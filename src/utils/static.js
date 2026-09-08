/**
 * utils/static.js — 静态资源服务（演示前端页面）
 *
 * 职责：
 *   - 把 public/ 目录下的文件作为静态资源返回
 *   - 安全的路径解析，防止目录穿越
 *   - 提供简单的缓存策略
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export async function serveStatic(req, res, pathname) {
  // 根路径 → index.html
  let filePath = pathname === '/' ? 'index.html' : pathname.slice(1)

  // 防止目录穿越：用 path.relative 判断是否越界（比 startsWith 更严谨）
  const full = path.normalize(path.join(PUBLIC_DIR, filePath))
  const rel = path.relative(PUBLIC_DIR, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  if (!existsSync(full)) {
    res.writeHead(404)
    res.end('Not Found')
    return
  }

  const data = await readFile(full)
  const ext = path.extname(full)
  const isHtml = ext === '.html'

  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    // HTML 不缓存（开发方便），静态资源缓存 1 小时
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
  })
  res.end(data)
}