/**
 * utils/multipart.js — multipart/form-data 解析器（零依赖）
 *
 * 职责：
 *   - 解析 multipart/form-data 请求体
 *   - 支持文本字段和二进制文件字段
 *   - 返回 { fields: {...}, files: [{ fieldName, filename, contentType, data(Buffer) }] }
 *
 * 设计说明：
 *   - 一次性读取整个 body 到 Buffer（演示项目，文件有大小限制）
 *   - 按 boundary 分割各 part，解析 Content-Disposition
 *   - 生产环境建议使用 busboy / formidable 等成熟库
 */
import { AppError } from './http.js'
import { config } from '../config.js'

/**
 * 解析 multipart/form-data 请求体
 * @param {Buffer} body 完整请求体
 * @param {string} contentType 请求头 Content-Type（含 boundary）
 */
export function parseMultipart(body, contentType) {
  // 提取 boundary
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!boundaryMatch) {
    throw new AppError(400, '缺少 multipart boundary', 'INVALID_MULTIPART')
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2]

  const delimiter = Buffer.from(`--${boundary}`)
  const result = { fields: {}, files: [] }

  // 按 boundary 分割
  let start = 0
  while (true) {
    const idx = body.indexOf(delimiter, start)
    if (idx === -1) break

    // 找到 part 的结束 boundary
    const partStart = idx + delimiter.length
    // 检查是否是结束标记（--\r\n）
    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) {
      break // 结束 boundary
    }

    // 跳过 \r\n
    let dataStart = partStart
    if (body[dataStart] === 0x0d && body[dataStart + 1] === 0x0a) {
      dataStart += 2
    }

    // 找下一个 boundary
    const nextIdx = body.indexOf(delimiter, dataStart)
    if (nextIdx === -1) break

    // part 数据（去掉结尾的 \r\n）
    let partEnd = nextIdx
    if (body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) {
      partEnd -= 2
    }

    const part = body.subarray(dataStart, partEnd)
    parsePart(part, result)

    start = nextIdx
  }

  return result
}

/** 解析单个 part：头部（headers）与内容（body）用空行分隔 */
function parsePart(part, result) {
  // 找头部与内容的分隔（\r\n\r\n）
  const headerEnd = part.indexOf('\r\n\r\n')
  if (headerEnd === -1) return

  const headerStr = part.subarray(0, headerEnd).toString('utf8')
  const content = part.subarray(headerEnd + 4)

  // 解析 Content-Disposition
  const disposition = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i)
  if (!disposition) return

  const fieldName = disposition[1]
  const filename = disposition[2]

  // 解析 Content-Type（文件才有）
  const contentTypeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i)
  const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : ''

  if (filename !== undefined) {
    // 文件字段
    result.files.push({
      fieldName,
      filename,
      contentType,
      data: Buffer.from(content), // 二进制数据
    })
  } else {
    // 普通文本字段
    result.fields[fieldName] = content.toString('utf8')
  }
}

/**
 * 从请求流中读取完整 body（Buffer）
 * @param {import('node:http').IncomingMessage} req
 */
export function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let tooLarge = false

    req.on('data', (chunk) => {
      total += chunk.length
      if (total > config.maxBodySize) {
        tooLarge = true
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (tooLarge) {
        reject(new AppError(413, '请求体过大', 'PAYLOAD_TOO_LARGE'))
        return
      }
      resolve(Buffer.concat(chunks))
    })

    req.on('error', () => {
      reject(new AppError(400, '读取请求体失败', 'BODY_READ_ERROR'))
    })
  })
}