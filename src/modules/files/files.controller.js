/**
 * files.controller.js — 控制器层（表现层）
 *
 * 职责：
 *   - 解析 HTTP 请求（读 body、取参数、取当前用户）
 *   - 调用 service 层执行业务
 *   - 把结果/异常转成 HTTP 响应
 *   - 记录操作审计
 *
 * 关键点：
 *   - Controller 里不做业务规则判断（那是 Service 的事）
 *   - Controller 负责"HTTP 语义"，Service 负责"业务语义"
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { FileService } from './files.service.js'
import { readJson, sendJSON, sendError } from '../../utils/http.js'
import { parseMultipart, readBodyBuffer } from '../../utils/multipart.js'
import { audit } from '../../utils/audit.js'

export class FilesController {
  constructor(service = new FileService()) {
    this.service = service
  }

  /** GET /api/files?page=1&pageSize=20&q=关键词&sortBy=updatedAt&order=desc&owner=xxx&ext=.sh&tag=部署,运维（多选，逗号分隔） */
  async list(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`)
      const page = url.searchParams.get('page')
      const pageSize = url.searchParams.get('pageSize')
      const q = url.searchParams.get('q') || ''
      const sortBy = url.searchParams.get('sortBy') || 'updatedAt'
      const order = url.searchParams.get('order') || 'desc'
      const owner = url.searchParams.get('owner') || ''
      const ext = url.searchParams.get('ext') || ''
      const tagRaw = url.searchParams.get('tag') || ''
      const tags = tagRaw.split(',').map((t) => t.trim()).filter(Boolean)
      const result = this.service.list(req.user.username, { page, pageSize, q, sortBy, order, owner, ext, tags })
      sendJSON(res, 200, result)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** GET /api/files/meta — 标签与上传者聚合（供前端筛选） */
  async listMeta(req, res) {
    try {
      const result = this.service.listMeta(req.user.username)
      sendJSON(res, 200, result)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** POST /api/files — 支持 JSON（文本）和 multipart/form-data（任意文件） */
  async create(req, res) {
    try {
      const contentType = req.headers['content-type'] || ''
      let item

      // multipart/form-data：文件上传（支持二进制）
      if (contentType.includes('multipart/form-data')) {
        const body = await readBodyBuffer(req)
        const parsed = parseMultipart(body, contentType)
        const file = parsed.files[0]
        if (!file) {
          sendError(res, 400, '未找到上传的文件', 'NO_FILE')
          return
        }
        item = await this.service.create({
          owner: req.user.username,
          name: file.filename,
          content: file.data,
          contentType: file.contentType || 'application/octet-stream',
          description: parsed.fields?.description,
          tags: parsed.fields?.tags,
        })
      } else {
        // JSON：文本上传
        const body = await readJson(req)
        item = await this.service.create({
          owner: req.user.username,
          name: body?.name,
          content: body?.content,
          contentType: 'text/plain; charset=utf-8',
          description: body?.description,
          tags: body?.tags,
        })
      }

      audit(req.user.username, 'upload', item.name, `id=${item.id}`)
      sendJSON(res, 201, item)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** GET /api/files/download/:id — 流式下载当前版本 */
  async download(req, res) {
    try {
      const { item, filePath } = this.service.getContentPath(req.params.id, req.user.username)

      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        sendError(res, 404, '文件内容不存在', 'NOT_FOUND')
        return
      }

      const encodedName = encodeURIComponent(item.name)
      res.writeHead(200, {
        'Content-Type': item.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
        'Content-Length': fileStat.size,
        'Cache-Control': 'no-store',
      })

      audit(req.user.username, 'download', item.name, `id=${item.id}`)

      const stream = createReadStream(filePath)
      stream.pipe(res)
      stream.on('error', () => {
        if (!res.headersSent) {
          sendError(res, 500, '读取文件失败', 'READ_ERROR')
        } else {
          res.destroy()
        }
      })
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** DELETE /api/files/:id */
  async remove(req, res) {
    try {
      const item = await this.service.remove(req.params.id, req.user.username, req.user.role)
      audit(req.user.username, 'delete', item.name, `id=${item.id}`)
      sendJSON(res, 200, { ok: true })
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  // ---------- 版本管理 ----------

  /** POST /api/files/:id/versions — 新增版本（支持 JSON 文本 和 multipart 文件） */
  async addVersion(req, res) {
    try {
      const contentType = req.headers['content-type'] || ''
      let content
      let changeNote

      if (contentType.includes('multipart/form-data')) {
        const body = await readBodyBuffer(req)
        const parsed = parseMultipart(body, contentType)
        const file = parsed.files[0]
        if (!file) {
          sendError(res, 400, '未找到上传的文件', 'NO_FILE')
          return
        }
        content = file.data
        changeNote = parsed.fields?.changeNote || ''
      } else {
        const body = await readJson(req)
        content = body?.content
        changeNote = body?.changeNote
      }

      const item = await this.service.addVersion(req.params.id, req.user.username, {
        content,
        changeNote,
      }, req.user.role)
      audit(req.user.username, 'version', item.name, `id=${item.id} v${item.currentVersion}`)
      sendJSON(res, 201, item)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** GET /api/files/:id/versions — 版本历史 */
  async listVersions(req, res) {
    try {
      const versions = this.service.listVersions(req.params.id, req.user.username)
      sendJSON(res, 200, versions)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** GET /api/files/:id/versions/:version — 查看指定版本内容 */
  async getVersion(req, res) {
    try {
      const { item, content } = await this.service.readVersionContent(
        req.params.id,
        Number(req.params.version),
        req.user.username
      )
      sendJSON(res, 200, { name: item.name, version: Number(req.params.version), content: content.toString('utf8') })
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** POST /api/files/:id/versions/:version/restore — 回滚 */
  async restoreVersion(req, res) {
    try {
      const item = await this.service.restoreVersion(req.params.id, Number(req.params.version), req.user.username, req.user.role)
      audit(req.user.username, 'restore', item.name, `id=${item.id} → v${item.currentVersion}`)
      sendJSON(res, 200, item)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** DELETE /api/files/:id/versions/:version — 删除版本 */
  async deleteVersion(req, res) {
    try {
      const item = await this.service.deleteVersion(req.params.id, Number(req.params.version), req.user.username, req.user.role)
      audit(req.user.username, 'delete-version', item.name, `id=${item.id} 删除 v${req.params.version}`)
      sendJSON(res, 200, item)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  // ---------- 共享与重命名 ----------

  /** PATCH /api/files/:id — 更新元数据（重命名 / 修改简介） */
  async update(req, res) {
    try {
      const body = await readJson(req)
      const item = await this.service.update(req.params.id, req.user.username, {
        name: body?.name,
        description: body?.description,
        tags: body?.tags,
      }, req.user.role)
      const action = body?.name !== undefined ? 'rename' : 'update_desc'
      audit(req.user.username, action, item.name, `id=${item.id}`)
      sendJSON(res, 200, item)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** POST /api/files/:id/share — 设置共享人 */
  async share(req, res) {
    try {
      const body = await readJson(req)
      const item = await this.service.setSharedWith(req.params.id, req.user.username, body?.usernames, req.user.role)
      audit(req.user.username, 'share', item.name, `sharedWith=${JSON.stringify(item.sharedWith)}`)
      sendJSON(res, 200, item)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }

  /** POST /api/files/:id/public — 设置公共/取消公共 */
  async setPublic(req, res) {
    try {
      const body = await readJson(req)
      const item = await this.service.setPublic(req.params.id, req.user.username, body?.isPublic, req.user.role)
      audit(req.user.username, 'public', item.name, `isPublic=${item.isPublic}`)
      sendJSON(res, 200, item)
    } catch (err) {
      sendError(res, err.status || 500, err.message, err.code)
    }
  }
}