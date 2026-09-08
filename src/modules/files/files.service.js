/**
 * files.service.js — 服务层 / 应用层（Application Layer）
 *
 * 职责：
 *   - 业务规则校验（文件名合法性、权限归属、共享权限）
 *   - 编排"读文件本体 + 读写元数据"
 *   - 不直接碰 HTTP，也不关心存储实现（只依赖 repo 接口）
 *
 * 这就是"分层"的好处：业务逻辑与存储/传输解耦。
 */
import { FileRepo } from './files.repo.js'
import { AppError } from '../../utils/http.js'
import { config } from '../../config.js'

// 规范：不允许的非法字符，防止路径穿越（安全）
const ILLEGAL = /[\/\\:*?"<>|\x00-\x1f]/

export class FileService {
  constructor(repo = new FileRepo()) {
    this.repo = repo
  }

  /** 列出用户可访问的文件（自己的 + 共享的 + 公共的），支持分页、搜索、排序、筛选 */
  list(username, { page = 1, pageSize = config.pageSize, q = '', sortBy = 'updatedAt', order = 'desc', owner = '', ext = '' } = {}) {
    const safePage = Math.max(1, Number(page) || 1)
    const safeSize = Math.min(100, Math.max(1, Number(pageSize) || config.pageSize))
    return this.repo.list(username, { page: safePage, pageSize: safeSize, q, sortBy, order, owner, ext })
  }

  /** 获取元数据并校验访问权限（owner 或共享或公共；admin 可读所有） */
  get(id, username, role) {
    const item = this.repo.get(id)
    if (!item) throw new AppError(404, '文件不存在', 'NOT_FOUND')
    if (!this._canRead(item, username, role)) {
      throw new AppError(403, '无权限访问该文件', 'FORBIDDEN')
    }
    return item
  }

  /** 校验是否为文件 owner（写操作需要）；admin 拥有所有文件的管理权限 */
  _requireOwner(item, username, role) {
    if (item.owner === username) return
    if (role === 'admin') return
    throw new AppError(403, '只有文件所有者或管理员才能执行此操作', 'FORBIDDEN')
  }

  /** 判断用户能否读取文件 */
  _canRead(item, username, role) {
    if (item.owner === username) return true
    if (role === 'admin') return true
    if (item.isPublic) return true
    if (Array.isArray(item.sharedWith) && item.sharedWith.includes(username)) return true
    return false
  }

  /** 创建文件：校验业务规则 → 交给 repo 落盘（支持文本 string 和二进制 Buffer） */
  async create({ owner, name, content, contentType, description }) {
    if (!name || name.trim().length === 0) throw new AppError(400, '文件名不能为空', 'INVALID_INPUT')
    if (name.length > 128) throw new AppError(400, '文件名过长', 'INVALID_INPUT')
    if (ILLEGAL.test(name)) throw new AppError(400, '文件名含有非法字符', 'INVALID_INPUT')

    if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
      throw new AppError(400, '文件内容缺失', 'INVALID_INPUT')
    }

    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8')
    if (size > config.maxFileSize) {
      throw new AppError(413, `单文件上限 ${Math.floor(config.maxFileSize / 1024 / 1024)}MB`, 'FILE_TOO_LARGE')
    }

    // 简介可选，限制长度
    const safeDesc = description ? String(description).trim().slice(0, 500) : ''

    return this.repo.create({ owner, name, content, contentType, description: safeDesc })
  }

  /** 新增版本（owner 才能操作） */
  async addVersion(id, owner, { content, changeNote }, role) {
    const item = this.get(id, owner)
    this._requireOwner(item, owner, role)

    if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
      throw new AppError(400, '文件内容缺失', 'INVALID_INPUT')
    }
    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8')
    if (size > config.maxFileSize) {
      throw new AppError(413, `单文件上限 ${Math.floor(config.maxFileSize / 1024 / 1024)}MB`, 'FILE_TOO_LARGE')
    }

    return this.repo.addVersion({ id, owner, content, changeNote })
  }

  /** 版本历史（可读用户可查看） */
  listVersions(id, username) {
    const item = this.get(id, username)
    return this.repo.listVersions(id)
  }

  /** 读取指定版本内容（可读用户可下载） */
  async readVersionContent(id, version, username) {
    const item = this.get(id, username)
    const content = await this.repo.readVersionContent(id, version)
    if (content === null) throw new AppError(404, '版本内容不存在', 'NOT_FOUND')
    return { item, content }
  }

  /** 回滚到指定版本（owner 才能操作） */
  async restoreVersion(id, version, owner, role) {
    const item = this.get(id, owner)
    this._requireOwner(item, owner, role)
    const result = await this.repo.restoreVersion(id, version, owner)
    if (!result) throw new AppError(404, '版本不存在', 'NOT_FOUND')
    return result
  }

  /** 删除指定版本（owner 才能操作） */
  async deleteVersion(id, version, owner, role) {
    const item = this.get(id, owner, role)
    this._requireOwner(item, owner, role)
    let result
    try {
      result = await this.repo.deleteVersion(id, version, owner)
    } catch (err) {
      if (err.message && err.message.includes('至少需要保留一个版本')) {
        throw new AppError(400, err.message, 'LAST_VERSION')
      }
      throw err
    }
    if (!result) throw new AppError(404, '版本不存在', 'NOT_FOUND')
    return result
  }

  /** 更新文件元数据：重命名 / 修改简介（owner 才能操作） */
  async update(id, owner, { name, description } = {}, role) {
    const item = this.get(id, owner)
    this._requireOwner(item, owner, role)

    // 重命名校验
    if (name !== undefined) {
      if (!name || name.trim().length === 0) throw new AppError(400, '文件名不能为空', 'INVALID_INPUT')
      if (ILLEGAL.test(name)) throw new AppError(400, '文件名含有非法字符', 'INVALID_INPUT')
      name = name.trim()
    }

    // 简介校验（可选，限制长度）
    let safeDesc
    if (description !== undefined) {
      safeDesc = description ? String(description).trim().slice(0, 500) : ''
    }

    return this.repo.update(id, { name, description: safeDesc })
  }

  /** 设置共享人列表（owner 才能操作） */
  async setSharedWith(id, owner, usernames, role) {
    const item = this.get(id, owner)
    this._requireOwner(item, owner, role)
    if (!Array.isArray(usernames)) throw new AppError(400, '共享人列表格式错误', 'INVALID_INPUT')
    return this.repo.setSharedWith(id, usernames)
  }

  /** 设置公共/取消公共（owner 才能操作） */
  async setPublic(id, owner, isPublic, role) {
    const item = this.get(id, owner)
    this._requireOwner(item, owner, role)
    return this.repo.setPublic(id, !!isPublic)
  }

  /** 获取文件本体的磁盘路径（供流式下载当前版本） */
  getContentPath(id, username) {
    const item = this.get(id, username)
    return { item, filePath: this.repo._contentPath(id, item.currentVersion) }
  }

  /** 删除文件（owner 才能操作） */
  async remove(id, owner, role) {
    const item = this.get(id, owner, role)
    this._requireOwner(item, owner, role)
    await this.repo.remove(id)
    return item
  }
}