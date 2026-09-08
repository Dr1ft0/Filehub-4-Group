/**
 * files.repo.js — 数据访问层 / 基础设施层（Infrastructure Layer）
 *
 * 职责：
 *   - 封装所有与数据存储的交互
 *   - 元数据（文件名/owner/共享/版本）存 SQLite
 *   - 文件本体按版本落盘到 uploads/{id}/v{version}
 *   - 上层(Service)只依赖本层提供的"接口语义"，不关心实现
 *
 * 设计说明：
 *   - 使用 SQLite 存储元数据，支持并发和可靠持久化
 *   - 文件本体按 `uploads/{id}/v{version}` 存盘，支持多版本
 *   - 生产环境：元数据 → PostgreSQL，文件本体 → 对象存储（MinIO/S3）
 */
import { randomUUID } from 'node:crypto'
import { writeFile, readFile, unlink, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { queryOne, queryAll, run, transaction } from '../../utils/sqlite.js'
import { config } from '../../config.js'
import { logger } from '../../utils/logger.js'

export class FileRepo {
  constructor() {
    // 确保上传目录存在
    if (!existsSync(config.uploadDir)) {
      mkdir(config.uploadDir, { recursive: true }).catch(() => {})
    }
  }

  /** 文件某版本的磁盘路径 */
  _contentPath(id, version) {
    return path.join(config.uploadDir, id, `v${version}`)
  }

  /** 文件目录 */
  _fileDir(id) {
    return path.join(config.uploadDir, id)
  }

  /**
   * 列出用户可访问的文件（自己的 + 共享给我的 + 公共的），支持分页和搜索
   * @param {string} username 当前用户
   * @param {object} opts { page, pageSize, q }
   */
  list(username, { page = 1, pageSize = config.pageSize, q = '', sortBy = 'updatedAt', order = 'desc', owner = '', ext = '' } = {}) {
    const where = []
    const params = []

    // 可访问条件：owner=自己 OR 共享给我 OR 公共
    where.push(`(owner = ? OR isPublic = 1 OR sharedWith LIKE ?)`)
    params.push(username, `%"${username}"%`)

    // 搜索（文件名 + 简介模糊）
    if (q) {
      where.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${q}%`, `%${q}%`)
    }

    // 按上传者筛选
    if (owner) {
      where.push('owner = ?')
      params.push(owner)
    }

    // 按文件后缀筛选（如 .sh / .py / .md）
    if (ext) {
      if (ext === '__other__') {
        // "其它"：排除已知后缀，只显示其他类型的文件
        const knownExts = ['.sh', '.py', '.js', '.md', '.json', '.txt', '.yml', '.sql', '.bat', '.zip']
        const notClauses = knownExts.map(() => 'LOWER(name) NOT LIKE ?').join(' AND ')
        where.push(`(${notClauses})`)
        knownExts.forEach((e) => params.push(`%${e}`))
      } else {
        const safeExt = String(ext).replace(/^\./, '').toLowerCase()
        if (safeExt) {
          where.push('LOWER(name) LIKE ?')
          params.push(`%.${safeExt}`)
        }
      }
    }

    // 排序字段白名单（防 SQL 注入）
    const sortMap = {
      updatedAt: 'updatedAt',
      name: 'name',
      size: 'size',
      createdAt: 'createdAt',
    }
    const sortCol = sortMap[sortBy] || 'updatedAt'
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC'

    const whereSql = where.join(' AND ')
    const total = queryOne(`SELECT COUNT(*) as cnt FROM files WHERE ${whereSql}`, ...params).cnt

    const offset = (page - 1) * pageSize
    const items = queryAll(
      `SELECT id, owner, name, size, contentType, currentVersion, isPublic, sharedWith, description, createdAt, updatedAt
       FROM files WHERE ${whereSql}
       ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset
    )

    // 解析 sharedWith JSON
    const parsed = items.map((i) => ({ ...i, isPublic: !!i.isPublic, sharedWith: JSON.parse(i.sharedWith || '[]') }))
    return { items: parsed, total, page, pageSize }
  }

  get(id) {
    const row = queryOne('SELECT * FROM files WHERE id = ?', id)
    if (!row) return null
    return { ...row, isPublic: !!row.isPublic, sharedWith: JSON.parse(row.sharedWith || '[]') }
  }

  /** 创建文件（首个版本） */
  async create({ owner, name, content, contentType, description }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')

    // 文件本体落盘 v1
    await mkdir(this._fileDir(id), { recursive: true })
    await writeFile(this._contentPath(id, 1), buf)

    // 元数据 + 版本记录（事务）
    transaction((db) => {
      db.prepare(
        `INSERT INTO files (id, owner, name, size, contentType, currentVersion, isPublic, sharedWith, description, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, 1, 0, '[]', ?, ?, ?)`
      ).run(id, owner, name, buf.length, contentType, description || null, now, now)

      db.prepare(
        `INSERT INTO file_versions (id, fileId, version, size, updatedBy, changeNote, createdAt)
         VALUES (?, ?, 1, ?, ?, ?, ?)`
      ).run(randomUUID(), id, buf.length, owner, '初始版本', now)
    })

    return this.get(id)
  }

  /** 新增版本 */
  async addVersion({ id, owner, content, changeNote }) {
    const file = this.get(id)
    if (!file) return null

    const newVersion = file.currentVersion + 1
    const now = new Date().toISOString()
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')

    // 落盘新版本
    await writeFile(this._contentPath(id, newVersion), buf)

    // 更新元数据 + 版本记录（事务）
    transaction((db) => {
      db.prepare(
        `UPDATE files SET currentVersion = ?, size = ?, updatedAt = ? WHERE id = ?`
      ).run(newVersion, buf.length, now, id)

      db.prepare(
        `INSERT INTO file_versions (id, fileId, version, size, updatedBy, changeNote, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), id, newVersion, buf.length, owner, changeNote || '', now)
    })

    return this.get(id)
  }

  /** 版本历史 */
  listVersions(id) {
    return queryAll(
      'SELECT version, size, updatedBy, changeNote, createdAt FROM file_versions WHERE fileId = ? ORDER BY version DESC',
      id
    )
  }

  /** 读取指定版本内容 */
  async readVersionContent(id, version) {
    const filePath = this._contentPath(id, version)
    if (!existsSync(filePath)) return null
    return readFile(filePath)
  }

  /** 回滚到指定版本：直接把当前版本指针切换到目标版本 */
  async restoreVersion(id, version, owner) {
    const file = this.get(id)
    if (!file) return null
    // 校验目标版本存在
    const content = await this.readVersionContent(id, version)
    if (content === null) return null
    // 若已是当前版本，无需操作
    if (file.currentVersion === version) return this.get(id)
    // 直接切换当前版本指针（不新增版本，符合"回滚"直觉）
    run(
      'UPDATE files SET currentVersion = ?, size = ?, updatedAt = ? WHERE id = ?',
      version,
      content.length,
      new Date().toISOString(),
      id
    )
    return this.get(id)
  }

  /** 删除指定版本（owner 才能操作） */
  async deleteVersion(id, version, owner) {
    const file = this.get(id)
    if (!file) return null

    // 校验目标版本存在
    const content = await this.readVersionContent(id, version)
    if (content === null) return null

    // 查询剩余版本数量
    const remaining = queryAll(
      'SELECT version FROM file_versions WHERE fileId = ? AND version != ? ORDER BY version DESC',
      id,
      version
    )
    if (remaining.length === 0) {
      throw new Error('至少需要保留一个版本，如需删除请删除整个文件')
    }

    // 删除版本记录
    run('DELETE FROM file_versions WHERE fileId = ? AND version = ?', id, version)

    // 删除磁盘上的版本文件
    const filePath = this._contentPath(id, version)
    if (existsSync(filePath)) {
      unlink(filePath).catch((err) => {
        logger.warn(`[FileRepo] 删除版本文件失败 ${id}/v${version}: ${err.message}`)
      })
    }

    // 若删除的是当前版本，切换到剩余版本中的最新版本
    if (file.currentVersion === version) {
      const newVersion = remaining[0].version
      const newContent = await this.readVersionContent(id, newVersion)
      run(
        'UPDATE files SET currentVersion = ?, size = ?, updatedAt = ? WHERE id = ?',
        newVersion,
        newContent ? newContent.length : 0,
        new Date().toISOString(),
        id
      )
    }

    return this.get(id)
  }

  /** 更新文件元数据（重命名 / 修改简介） */
  async update(id, { name, description } = {}) {
    const file = this.get(id)
    if (!file) return null
    const now = new Date().toISOString()
    const newName = name !== undefined ? name : file.name
    const newDesc = description !== undefined ? description : file.description
    run('UPDATE files SET name = ?, description = ?, updatedAt = ? WHERE id = ?', newName, newDesc, now, id)
    return this.get(id)
  }

  /** 设置共享人列表 */
  async setSharedWith(id, usernames) {
    run('UPDATE files SET sharedWith = ?, updatedAt = ? WHERE id = ?', JSON.stringify(usernames), new Date().toISOString(), id)
    return this.get(id)
  }

  /** 设置公共/取消公共 */
  async setPublic(id, isPublic) {
    run('UPDATE files SET isPublic = ?, updatedAt = ? WHERE id = ?', isPublic ? 1 : 0, new Date().toISOString(), id)
    return this.get(id)
  }

  /** 删除文件：移除元数据 + 删除整个文件目录 */
  async remove(id) {
    const file = this.get(id)
    if (!file) return false

    // 删除元数据（级联删除版本记录）
    run('DELETE FROM files WHERE id = ?', id)

    // 删除文件目录（含所有版本）
    const dir = this._fileDir(id)
    if (existsSync(dir)) {
      rm(dir, { recursive: true, force: true }).catch((err) => {
        logger.warn(`[FileRepo] 删除文件目录失败 ${id}: ${err.message}`)
      })
    }
    return true
  }

  /** 清理孤儿元数据：元数据存在但磁盘文件缺失的记录 */
  async cleanupOrphans() {
    const files = queryAll('SELECT id FROM files')
    let count = 0
    for (const f of files) {
      const file = this.get(f.id)
      if (file && !existsSync(this._contentPath(f.id, file.currentVersion))) {
        run('DELETE FROM files WHERE id = ?', f.id)
        count++
      }
    }
    if (count > 0) logger.warn(`[FileRepo] 已清理 ${count} 条孤儿元数据`)
    return count
  }
}