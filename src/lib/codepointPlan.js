// 码位规划与告警
// 保留区：默认 U+EE00–U+EFFF（512 个），本项目新增图标按顺序取用；
// 参考字体映射（unicode-map.data.js）已占用的码位段：E000–E8CC / F000+，不与保留区重叠。
// 可配置：public/codepoint-plan.data.js 的 project_alloc.start/end 会覆盖下面默认值
//（绿色版读同目录 codepoint-plan.data.js；改文件后刷新页面即生效，见 initCodepointPlan）
import { loadDataScript } from './loadDataScript.js'
import planInline from '../assets/plan-snapshot.json?url'

// 默认保留区（与 public/codepoint-plan.data.js 的 project_alloc 一致）；运行时可能被配置覆盖
export const RESERVED = { start: 0xee00, end: 0xefff }

// 参考字体占用的分段统计口径（与配置文件的 reference_sections 一致）；
// 各段边界可在 codepoint-plan.data.js 中编辑，应用启动时读取覆盖
export const REFERENCE_SECTIONS = {
  bmp: { start: 0xe000, end: 0xf8ff },
  sections: [
    { range: 'E000–E8CC', start: 0xe000, end: 0xe8cc },
    { range: 'E8CD–EFFF', start: 0xe8cd, end: 0xefff },
    { range: 'F000–F0FF', start: 0xf000, end: 0xf0ff },
    { range: 'F100–F8FF', start: 0xf100, end: 0xf8ff }
  ]
}

// 应用配置里的参考分段（reference_sections.sections：start/end 支持 "U+E000" / "E000" 形式）
function applyReferenceSections(raw) {
  try {
    const rs = raw && raw.reference_sections
    if (!rs) return false
    const list = Array.isArray(rs.sections) ? rs.sections : []
    const parsed = []
    for (const s of list) {
      const start = toCode(s.start)
      const end = toCode(s.end)
      if (start == null || end == null || end <= start) continue
      parsed.push({ range: s.range || (start.toString(16).toUpperCase() + '–' + end.toString(16).toUpperCase()), start, end })
    }
    if (!parsed.length) return false
    REFERENCE_SECTIONS.sections = parsed
    const bmpS = toCode(rs.bmp && rs.bmp.start)
    const bmpE = toCode(rs.bmp && rs.bmp.end)
    if (bmpS != null && bmpE != null && bmpE > bmpS) REFERENCE_SECTIONS.bmp = { start: bmpS, end: bmpE }
    return true
  } catch {
    return false
  }
}

// 基础字形区间：buildFont 内置的可见 ASCII 94 字符（0x21-0x7E）+ 空格(0x20)
// 这些码位已被内置拉丁字形占用。导入图标若保持原 unicode 落在此区间，
// 生成字体时会因「重复 unicode」报错（fonteditor 抛 Repeat unicode），必须提醒
export const BASE_ASCII_START = 0x20
export const BASE_ASCII_END = 0x7e

// 从 store 图标列表计算保留区已用/剩余（按当前生效的保留区范围）
export function reservedUsage(icons) {
  let used = 0
  const usedCodes = new Set(icons.map((i) => i.code))
  for (let c = RESERVED.start; c <= RESERVED.end; c++) if (usedCodes.has(c)) used++
  const total = RESERVED.end - RESERVED.start + 1
  return { used, total, free: total - used }
}

// 是否落在内置基础字形区间（ASCII 0x20-0x7E）——保持原码位时与该区冲突会导致字体构建报错
export function isBaseAscii(code) {
  return typeof code === 'number' && code >= BASE_ASCII_START && code <= BASE_ASCII_END
}

// Unicode 非字符（noncharacter）：U+FDD0–U+FDEF、以及每个平面末尾的 U+xFFFE / U+xFFFF。
// 为什么需要判定：字体里的 glyph 0（.notdef）常被赋予 U+FFFF 这类非字符码位；
// 若把它当普通图标带进字体构建，fonteditor 解析到该码位会中断，导致其后的图标字形全部丢失
// （2026-09 实测：某参考字体解析导入后导出字体只剩基础字形，即此原因）。
export function isNoncharacter(code) {
  if (typeof code !== 'number' || !isFinite(code)) return false
  if (code >= 0xfdd0 && code <= 0xfdef) return true
  const low = code & 0xffff
  if (low === 0xfffe || low === 0xffff) return true
  return false
}

// 是否是不应作为图标导出的字形名（字体固定的 glyph 0 名）
export function isNotdefName(name) {
  return String(name || '').trim().toLowerCase() === '.notdef'
}

// 供「导入时保持原 unicode」校验：原码位是否落在保留区（会与自动分配图标争抢区域）
export function isInReserved(code) {
  return typeof code === 'number' && code >= RESERVED.start && code <= RESERVED.end
}

// 解析 "U+EE00" / "EE00" / 0xEE00 形式的码位
function toCode(v) {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null
  const hex = v.trim().replace(/^u\+?/i, '')
  if (!/^[0-9a-f]{2,6}$/i.test(hex)) return null
  return parseInt(hex, 16)
}

// 应用配置：project_alloc 覆盖本项目保留区；reference_sections 覆盖参考分段口径（非法值忽略并保留默认）
export function applyCodepointPlan(raw) {
  let ok = false
  try {
    const alloc = raw && raw.project_alloc
    if (alloc) {
      const start = toCode(alloc.start)
      const end = toCode(alloc.end)
      if (start != null && end != null && end > start) {
        RESERVED.start = start
        RESERVED.end = end
        ok = true
      }
    }
  } catch { /* 保留默认 */ }
  applyReferenceSections(raw)
  return ok
}

// 启动时读取码位规划配置（开发版与构建版一致：动态加载 ./codepoint-plan.data.js；
// 文件缺失时回退构建内联快照）。必须在应用挂载前 await，保证 store 初始化（nextCode 起点）用上配置值
export async function initCodepointPlan() {
  const fromScript = await loadDataScript('codepoint-plan.data.js', '__SNFONT_CODEPOINT_PLAN__')
  if (fromScript) return applyCodepointPlan(fromScript)
  try {
    const res2 = await fetch(planInline)
    return applyCodepointPlan(await res2.json())
  } catch {
    return false
  }
}
