/**
 * utils/password.js — 密码哈希工具（零依赖，Node 内置 crypto）
 *
 * 职责：
 *   - 使用 scrypt 对密码做加盐哈希
 *   - 提供校验函数，用于登录比对
 *
 * 设计说明：
 *   - 格式：`scrypt$N$r$p$salt$hash`，便于将来调整参数
 *   - 使用 timingSafeEqual 做恒定时间比较，防时序攻击
 *   - 生产环境建议换用 bcrypt/argon2 等专用库
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

// scrypt 参数（内存/CPU 成本）
const N = 16384 // CPU/内存成本
const r = 8 // 块大小
const p = 1 // 并行度
const KEYLEN = 64

/** 生成密码哈希 */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p }).toString('hex')
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`
}

/** 校验密码是否匹配 */
export function verifyPassword(password, stored) {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, n, rr, pp, salt, hash] = parts
    const expected = Buffer.from(hash, 'hex')
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(rr),
      p: Number(pp),
    })
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}