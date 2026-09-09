/**
 * files.routes.js — 路由层（接口定义）
 *
 * 职责：
 *   - 定义文件模块的 HTTP 接口地图
 *   - 每个接口调用 controller 处理，不写逻辑
 *
 * 模块遵循"4 层分离"：
 *   routes → controller → service → repo
 */
import { FilesController } from './files.controller.js'

export function filesRoutes() {
  const controller = new FilesController()

  return [
    // 文件 CRUD
    {
      method: 'GET',
      path: '/api/files',
      handler: (req, res) => controller.list(req, res),
    },
    {
      method: 'GET',
      path: '/api/files/meta',
      handler: (req, res) => controller.listMeta(req, res),
    },
    {
      method: 'POST',
      path: '/api/files',
      handler: (req, res) => controller.create(req, res),
    },
    {
      method: 'GET',
      path: '/api/files/download/:id',
      handler: (req, res) => controller.download(req, res),
    },
    {
      method: 'DELETE',
      path: '/api/files/:id',
      handler: (req, res) => controller.remove(req, res),
    },
    {
      method: 'PATCH',
      path: '/api/files/:id',
      handler: (req, res) => controller.update(req, res),
    },

    // 版本管理
    {
      method: 'POST',
      path: '/api/files/:id/versions',
      handler: (req, res) => controller.addVersion(req, res),
    },
    {
      method: 'GET',
      path: '/api/files/:id/versions',
      handler: (req, res) => controller.listVersions(req, res),
    },
    {
      method: 'GET',
      path: '/api/files/:id/versions/:version',
      handler: (req, res) => controller.getVersion(req, res),
    },
    {
      method: 'POST',
      path: '/api/files/:id/versions/:version/restore',
      handler: (req, res) => controller.restoreVersion(req, res),
    },
    {
      method: 'DELETE',
      path: '/api/files/:id/versions/:version',
      handler: (req, res) => controller.deleteVersion(req, res),
    },

    // 共享
    {
      method: 'POST',
      path: '/api/files/:id/share',
      handler: (req, res) => controller.share(req, res),
    },
    {
      method: 'POST',
      path: '/api/files/:id/public',
      handler: (req, res) => controller.setPublic(req, res),
    },
  ]
}