/**
 * utils/logger.js — 结构化日志工具
 *
 * 职责：
 *   - 提供分级日志（info / warn / error / debug）
 *   - 输出带时间戳和级别的结构化格式
 *   - 同时输出到控制台和文件（按天滚动）
 *   - 生产环境可关闭 debug 日志
 *
 * 设计说明：
 *   - 零依赖，纯 console + fs 封装
 *   - 统一格式：`[时间] [级别] 消息`
 *   - 日志文件按天命名：`data/logs/app-YYYY-MM-DD.log`
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

function ts() {
  return new Date().toISOString()
}

/** 获取当天日志文件名 */
function logFilePath() {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(config.logDir, `app-${date}.log`)
}

/** 写入日志文件（同步，保证顺序） */
function writeToFile(line) {
  try {
    mkdirSync(config.logDir, { recursive: true })
    appendFileSync(logFilePath(), line + '\n', 'utf8')
  } catch {
    // 日志文件写入失败不影响主流程
  }
}

function log(level, ...args) {
  // debug 日志仅在非生产环境输出
  if (level === 'debug' && config.isProd) return
  const prefix = `[${ts()}] [${level.toUpperCase()}]`
  const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  const line = `${prefix} ${message}`

  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }

  // 落盘
  writeToFile(line)
}

export const logger = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  /** 请求日志：记录方法、路径、状态码、耗时 */
  request: (method, path, status, durationMs) => {
    log('info', `${method} ${path} → ${status} (${durationMs}ms)`)
  },
}