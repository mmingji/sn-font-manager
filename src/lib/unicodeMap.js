// unicode → 图标名称 映射表（#8）
// 数据来源：内置映射文件 public/unicode-map.data.js（直接编辑即可维护名称）
// loadBuiltinMap(true) 强制 no-cache 重读，供解析字体命名与管理页按映射批量改名使用
// 兼容两种格式：
// 1. 嵌套格式: { "icon-name": { "unicode": "f8f8", ... } }
// 2. 扁平格式: { "f8f8": "icon-name" } 或 { "icon-name": "f8f8" }

// 加载内置映射表（从 public 静态资源；force=true 时绕过内存缓存重新拉取）
// 运行时动态加载（带时间戳）：确保打开/刷新页面时总是读取磁盘上的最新映射文件
// 映射文件缺失/加载失败时：回退到构建时内联的快照（src/assets/map-snapshot.json，由 data.js 提取）
import mapJsonInline from '../assets/map-snapshot.json?url'
import { loadDataScript } from './loadDataScript.js'

// 数据来源（开发版与构建版一致，统一用 unicode-map.data.js）：
// 1) 动态加载可编辑数据文件 ./unicode-map.data.js（经典 script + 时间戳绕过缓存 → 改文件刷新即生效）
// 2) 兜底：构建时内联的快照（用户删掉该文件时仍能用）
async function fetchMapJson() {
  const fromScript = await loadDataScript('unicode-map.data.js', '__SNFONT_UNICODE_MAP__')
  if (fromScript) return fromScript
  const res = await fetch(mapJsonInline)
  return await res.json()
}

// hex 码位归一化：去 u+/U+ 前缀、小写、去前导零
// 为什么必须统一：卡片码位按 4 位补齐显示（0075），用户会照着这个格式贴映射；
// 而内部查找用 code.toString(16)（不补齐，75）。两边格式不一致时，用户贴的
// {"0075":"name"} 会躺进映射表（统计数照涨）却永远命不中卡片（2026-09 实测）。
// 归一化后 0075 / 75 / U+0075 / u0075 都归一到 "75"，与查找侧一致。
// 注意剥前缀的前瞻 (?=[0-9a-f])：裸名字 "u"（图标名）不能把 u 当前缀剥掉
function normalizeHex(hex) {
  const h = String(hex).toLowerCase().replace(/^u\+?(?=[0-9a-f])/, '').replace(/^0+/, '')
  return h || '0'
}

let builtinCache = null
export async function loadBuiltinMap(force = false) {
  if (builtinCache && !force) return builtinCache
  try {
    const data = await fetchMapJson()
    // 归一化为 { hexCode: name }（hex 去前导零小写，见 normalizeHex）
    const map = {}
    for (const [name, unicode] of Object.entries(data)) {
      const hex = normalizeHex(unicode)
      if (/^[0-9a-f]{1,6}$/.test(hex)) map[hex] = name
    }
    builtinCache = map
    return map
  } catch {
    return {}
  }
}

// 解析用户提供的映射数据，返回 { hexCode: name } 的小写 hex → 名称 映射
// hex 一律归一化（去前导零），与 loadBuiltinMap / applyUnicodeNameMap 的查找 key 一致
export function parseUnicodeMap(json) {
  try {
    const data = JSON.parse(json)
    const map = {}
    if (!data || typeof data !== 'object') return map

    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && typeof value.unicode === 'string') {
        // 嵌套格式: { "trash": { "unicode": "f1f8" } }
        const hex = normalizeHex(value.unicode)
        if (/^[0-9a-f]{1,6}$/.test(hex)) map[hex] = key
      } else if (typeof value === 'string') {
        // { "f8f8": "name" } 或 { "name": "f8f8" }
        const k = normalizeHex(key)
        const v = normalizeHex(value)
        if (/^[0-9a-f]{1,6}$/.test(k)) map[k] = value // key 是 hex
        else if (/^[0-9a-f]{1,6}$/.test(v)) map[v] = key // value 是 hex
      }
    }
    return map
  } catch {
    return {}
  }
}

// ASCII 基础字符（0x21-0x7E）的 AGL/PostScript 标准字形名兜底表。
// 为什么放在代码里而不只依赖映射文件：映射文件是 {name:hex} 结构，参考字体图标的
// slash/less 等命名与标准名重名时会互相覆盖（JSON key 唯一），导致这些码位没名字
// （2026-09 实测：slash 被参考字体映射里的 slash:f715 顶掉、less 被 less:f41d 顶掉）。
// 标准名是字体行业通用约定，代码兜底最稳；映射文件仍可覆盖（命中优先于兜底）。
const AGL_ASCII_NAMES = {
  '21': 'exclam', '22': 'quotedbl', '23': 'numbersign', '24': 'dollar', '25': 'percent',
  '26': 'ampersand', '27': 'quoteright', '28': 'parenleft', '29': 'parenright', '2a': 'asterisk',
  '2b': 'plus', '2c': 'comma', '2d': 'hyphen', '2e': 'period', '2f': 'slash',
  '3a': 'colon', '3b': 'semicolon', '3c': 'less', '3d': 'equal', '3e': 'greater',
  '3f': 'question', '40': 'at',
  '5b': 'bracketleft', '5c': 'backslash', '5d': 'bracketright', '5e': 'asciicircum',
  '5f': 'underscore', '60': 'quoteleft',
  '7b': 'braceleft', '7c': 'bar', '7d': 'braceright', '7e': 'asciitilde'
}
for (let c = 0x41; c <= 0x5a; c++) AGL_ASCII_NAMES[c.toString(16)] = String.fromCharCode(c)
for (let c = 0x61; c <= 0x7a; c++) AGL_ASCII_NAMES[c.toString(16)] = String.fromCharCode(c)

// 码位 → 名称解析：先查映射表（用户数据优先），未命中且码位在 ASCII 基础字符区时
// 用 AGL 标准名兜底。供 applyUnicodeNameMap 与 FontParser 的生效统计共用，
// 保证「显示的名字」与「统计口径」一致
export function resolveMappedName(code, map) {
  if (code == null) return null
  const hex = code.toString(16).toLowerCase()
  if (map[hex]) return map[hex]
  if (code >= 0x21 && code <= 0x7e && AGL_ASCII_NAMES[hex]) return AGL_ASCII_NAMES[hex]
  return null
}

// 用映射表给无名字的字形补名
// items: [{ name, unicode, unicodeAll? }]，unicode 为十进制数字或 null；
//        unicodeAll 为该字形在源字体中的全部码位（同一字形可能映射多个码位），逐码位查映射取第一个命中
// map: { hexCode: name }
// 返回补名后的 items（有名字的保留，无名字但命中映射的用映射名，仍无名的用 glyph-N）
// 占位名（glyph/uni/u/iNNN/gid 开头等自动生成的名字）也尝试用映射补名
export function applyUnicodeNameMap(items, map) {
  return items.map((item, i) => {
    const name = item.name || ''
    const isPlaceholder =
      !name ||
      name === 'glyph' ||
      name.startsWith('glyph') ||
      name.startsWith('uni') ||
      name.startsWith('u') ||
      /^i\d+$/.test(name) ||
      /^gid\d+$/.test(name)
    // 候选码位：先查主码位（unicode，PUA 优先选出的那个），再查其余码位（升序）。
    // 为什么主码位优先：一个字形的旁路码位可能落在内置 ASCII 区（如感叹号占 0021+F12A），
    // 若按码位升序查会先命中 ASCII 标准名（21=exclam）而非图标命名（f12a=exclamation），
    // 与「导入图标字体用图标名」的预期不符（2026-09 实测调整）
    const codes = Array.isArray(item.unicodeAll) && item.unicodeAll.length
      ? [item.unicode, ...item.unicodeAll.filter((c) => c !== item.unicode)]
      : (item.unicode != null ? [item.unicode] : [])
    // 映射命中：逐码位取第一个（映射表是码位→名称的权威来源）
    let mapped = null
    for (const code of codes) {
      const hit = map[code.toString(16).toLowerCase()]
      if (hit) {
        mapped = hit
        break
      }
    }
    // 映射未命中且原名是占位名时，ASCII 基础字符用 AGL 标准名兜底（slash/less 等
    // 与参考字体图标重名被映射文件顶掉的码位靠这个保底；非占位名不兜底，保留字体原名）
    if (!mapped && isPlaceholder) {
      for (const code of codes) {
        const std = resolveMappedName(code, {})
        if (std) {
          mapped = std
          break
        }
      }
    }
    // 有意义的名字（非占位）且映射未命中：保留原名字
    if (!isPlaceholder && !mapped) return item
    // 命中映射：用映射名替换（含占位名与撞码位的非占位名）
    if (mapped) return { ...item, name: mapped }
    // 兜底：glyph-N
    return { ...item, name: `glyph-${i + 1}` }
  })
}
