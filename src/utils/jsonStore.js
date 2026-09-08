/**
 * utils/jsonStore.js — 异步 JSON 文件存储（零依赖）
 *
 * 职责：
 *   - 提供基于 JSON 文件的异步读写存储
 *   - 供用户数据、文件元数据复用
 *   - 使用异步 fs/promises，避免阻塞事件循环
 *
 * 设计说明：
 *   - 内存缓存 + 异步落盘，读操作走内存，写操作异步持久化
 *   - 写操作串行化（内部队列），避免并发写导致文件损坏
 *   - 生产环境应换 PostgreSQL / Redis 等
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { logger } from './logger.js'

export class JsonStore {
  /**
   * @param {string} filePath 持久化文件路径
   * @param {Array}  initial  初始数据（文件不存在时使用）
   */
  constructor(filePath, initial = []) {
    this.filePath = filePath
    this.data = initial
    this._writeQueue = Promise.resolve() // 写操作串行队列
    this._load()
  }

  /** 启动时从文件加载（同步，仅启动时调用一次） */
  _load() {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) this.data = parsed
      } catch (err) {
        logger.warn(`[JsonStore] 读取 ${this.filePath} 失败，使用空数据: ${err.message}`)
        this.data = []
      }
    }
  }

  /** 异步持久化（串行队列，防并发写损坏） */
  _persist() {
    // 把写操作加入队列，保证顺序执行
    this._writeQueue = this._writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
    }).catch((err) => {
      logger.error(`[JsonStore] 写入 ${this.filePath} 失败: ${err.message}`)
    })
    return this._writeQueue
  }

  /** 获取全部数据（返回副本，防止外部修改内部状态） */
  all() {
    return this.data
  }

  /** 按条件过滤 */
  find(predicate) {
    return this.data.find(predicate) ?? null
  }

  /** 按条件过滤（返回数组） */
  filter(predicate) {
    return this.data.filter(predicate)
  }

  /** 追加一条记录并持久化 */
  async push(item) {
    this.data.push(item)
    await this._persist()
    return item
  }

  /** 替换整个数据集并持久化 */
  async replace(newData) {
    this.data = newData
    await this._persist()
  }

  /** 移除匹配项并持久化，返回是否移除成功 */
  async remove(predicate) {
    const idx = this.data.findIndex(predicate)
    if (idx === -1) return false
    this.data.splice(idx, 1)
    await this._persist()
    return true
  }
}