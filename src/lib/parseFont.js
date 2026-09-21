// 字体文件解析：将 ttf/otf/woff/woff2 解析为统一尺寸的 SVG 文件
// 引擎选型（重要）：opentype.js 解析 CFF/OTF 字体的紧凑曲线编码（vv/hv/vh/hvcurveto）
// 存在控制点错位 bug——实测某商业图标字体的细线圆环（内外圆半径比 72/56）
// 被解析成粗环（500/333），"只有单圆圈/单线条图标粗细大小不对"即此因（2026-09 排查实锤）。
// fontkit（2.x，浏览器官方构建）对 CFF/TrueType 均正确，改为 fontkit 取轮廓。
// 流程：woff2 → fonteditor wasm decode 成 ttf（无损，已验证）→ fontkit 解析
import { create as fontkitCreate } from './fontkit-bundle.mjs'
import fonteditor from 'fonteditor-core'
import { isNoncharacter, isNotdefName } from './codepointPlan.js'
// woff2 编解码 wasm：以 ?url 导入 → 构建时内联为 dataURL（file:// 下无法 fetch 外部文件）
// 资源来源：构建前置脚本 scripts/sync-inline-assets.mjs 从 public/woff2.wasm 同步
import woff2WasmUrl from '../assets/woff2.wasm?url'

const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2']

export function isFontFile(file) {
  const name = (file.name || '').toLowerCase()
  return FONT_EXT.some((ext) => name.endsWith('.' + ext))
}

// 判断 buffer 是否为 woff2（魔数 wOF2）
function isWoff2Buffer(buffer) {
  if (buffer.byteLength < 4) return false
  const dv = new DataView(buffer)
  return dv.getUint32(0) === 0x774f4632 // 'wOF2'
}

let woff2Ready = null
function ensureWoff2() {
  if (!woff2Ready) {
    woff2Ready = fonteditor.woff2.init(woff2WasmUrl)
  }
  return woff2Ready
}

// 将 buffer 规范化为 fontkit 可解析的 ttf/otf buffer（woff2 先经 wasm 无损解码）
async function toParseableBuffer(buffer) {
  if (isWoff2Buffer(buffer)) {
    await ensureWoff2()
    const ttf = fonteditor.woff2.decode(buffer)
    return ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength)
  }
  return buffer
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  })
}

// fontkit Path 命令 → 通用命令序列（保留字体内部坐标：y 向上、baseline=0）
// y 翻转与 em 归一化统一在 glyphToPathData 中处理，避免两处坐标变换互相干扰
function fontkitPathToCommands(pathCmd) {
  const out = []
  for (const c of pathCmd.commands) {
    switch (c.command) {
      case 'moveTo': out.push({ type: 'M', x: c.args[0], y: c.args[1] }); break
      case 'lineTo': out.push({ type: 'L', x: c.args[0], y: c.args[1] }); break
      case 'bezierCurveTo': out.push({ type: 'C', x1: c.args[0], y1: c.args[1], x2: c.args[2], y2: c.args[3], x: c.args[4], y: c.args[5] }); break
      case 'quadraticCurveTo': out.push({ type: 'Q', x1: c.args[0], y1: c.args[1], x: c.args[2], y: c.args[3] }); break
      case 'closePath': out.push({ type: 'Z' }); break
      default: break
    }
  }
  return out
}

// 将命令序列转换为 svg path 数据
// **按 em 方格（unitsPerEm）缩放，保留字形在字体中的原始尺寸与位置**——
// 不能按各自 bbox 放大到满格：那会把"小图形"（如 wifi-weak 的小圆圈，实测仅占 em 的 18.75%）
// 强行放大成满格大圆，与字体设计意图和其他图标的大小关系都不符（2026-09 用户实测反馈）
// 坐标映射：x 先按字符格(advanceWidth)居中，再 typeface 坐标 × scale；
//          y 由字体坐标（向上，baseline=0）翻转为 SVG 坐标（向下）：ascender → 0、baseline → ascender×scale
// metrics: { unitsPerEm, ascender, advanceWidth }
function glyphToPathData(cmds, metrics = {}) {
  if (!cmds.length) return ''
  const unitsPerEm = metrics.unitsPerEm || 1000
  const ascender = metrics.ascender != null ? metrics.ascender : unitsPerEm * 0.8
  const advanceWidth = metrics.advanceWidth != null ? metrics.advanceWidth : unitsPerEm
  const s = 1000 / unitsPerEm
  const ox = (1000 - advanceWidth * s) / 2 // 字符格在 1000 视框内居中

  // bbox（字体坐标）用于"轻量平移防出框"（只平移不缩放，保持尺寸真实）
  let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity
  const collect = (x, y) => {
    if (x < fMinX) fMinX = x
    if (x > fMaxX) fMaxX = x
    if (y < fMinY) fMinY = y
    if (y > fMaxY) fMaxY = y
  }
  for (const c of cmds) {
    switch (c.type) {
      case 'M': case 'L': collect(c.x, c.y); break
      case 'C': collect(c.x1, c.y1); collect(c.x2, c.y2); collect(c.x, c.y); break
      case 'Q': collect(c.x1, c.y1); collect(c.x, c.y); break
    }
  }
  if (!isFinite(fMinX) || !isFinite(fMinY)) return ''
  if (fMaxX - fMinX <= 0 && fMaxY - fMinY <= 0) return ''

  // —— 溢出保护（两步）——
  // ① 字形比 em 方格还大（出血字形）：等比收缩到刚好放入 1000 视框（只缩不放，保完整不裁切）
  // ② 收缩后仍偏出视框：整体平移回框内（只平移不改尺寸）
  // 注意：① 必须存在——仅靠平移无法容纳"宽度 > 视框"的字形，会把对侧裁掉（用户实测反馈）
  const rawX0 = fMinX * s + ox, rawX1 = fMaxX * s + ox
  const rawY0 = (ascender - fMaxY) * s, rawY1 = (ascender - fMinY) * s
  const rawW = rawX1 - rawX0
  const rawH = rawY1 - rawY0
  const shrink = Math.min(1, 1000 / Math.max(rawW, 1000), 1000 / Math.max(rawH, 1000))
  // 以字形 bbox 左上角为锚点做收缩，再统一平移
  const sx = (v) => v * shrink
  let x0 = sx(rawX0), x1 = sx(rawX1), y0 = sx(rawY0), y1 = sx(rawY1)
  let shiftX = 0, shiftY = 0
  if (x0 < 0) shiftX = -x0
  if (x1 + shiftX > 1000) shiftX = 1000 - x1
  if (y0 < 0) shiftY = -y0
  if (y1 + shiftY > 1000) shiftY = 1000 - y1

  const tx = (x) => +((x * s + ox) * shrink + shiftX).toFixed(2)
  const ty = (y) => +(((ascender - y) * s) * shrink + shiftY).toFixed(2)

  let d = ''
  for (const c of cmds) {
    switch (c.type) {
      case 'M': d += `M${tx(c.x)} ${ty(c.y)}`; break
      case 'L': d += `L${tx(c.x)} ${ty(c.y)}`; break
      case 'C': d += `C${tx(c.x1)} ${ty(c.y1)} ${tx(c.x2)} ${ty(c.y2)} ${tx(c.x)} ${ty(c.y)}`; break
      case 'Q': d += `Q${tx(c.x1)} ${ty(c.y1)} ${tx(c.x)} ${ty(c.y)}`; break
      case 'Z': d += 'Z'; break
      default: break
    }
  }
  return d
}

// 私有使用区（PUA）码位判定：BMP E000–F8FF / 补充 PUA-A F0000–FFFFD / PUA-B 100000–10FFFD
// 为什么需要：源字体常把同一字形同时映射到 PUA 码位与真实 Unicode 码位（如播放键
// 同时占 U+F04B 与 U+25B6）。主码位取 PUA 段，图标才不占用真实文本字符码位
// （否则用户在文档里敲 ▶/£/× 会渲染出图标），也与码位规划里"参考图标占 PUA 段"的口径一致
function isPuaCode(cp) {
  return (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd)
}

// 从字形的全部码位中选主码位：优先 PUA 段码位，无 PUA 码位时取最小码位（cps 为升序数组）
function pickPrimaryCode(cps) {
  const pua = cps.find(isPuaCode)
  return pua != null ? pua : cps[0]
}

// 解析字体文件为 { name, svg } 列表
// size: SVG 边长（输出 viewBox 1000 系，width/height=size）
export async function parseFontFile(file, size = 512) {
  const raw = await file.arrayBuffer()
  const buffer = await toParseableBuffer(raw)
  // fontkit：ttf/otf 均支持；CFF 轮廓提取正确（opentype.js 的 bug 见文件头注释）
  const font = fontkitCreate(new Uint8Array(buffer))

  const result = []
  const seenNames = new Set()

  // fontkit 无按 glyph 索引遍历的公开 API，用 characterSet（码位列表）反查，
  // 按 glyph id 排序输出，保持与"字形序"一致的稳定顺序；无 unicode 的字形不导出
  //（woff2 制作时通常已剔除；与 opentype 的差异仅为极少数无码位字形）
  // 同一字形可能被 cmap 映射到多个码位（多对一）：全部收集，主码位由 pickPrimaryCode
  // 选取，其余码位只作查名候选与别名提示，避免同一字形重复导出
  const byGlyph = new Map() // glyphId → 全部码位（characterSet 升序，收集即有序）
  for (const cp of font.characterSet) {
    const g = font.glyphForCodePoint(cp)
    if (!g) continue
    if (!byGlyph.has(g.id)) byGlyph.set(g.id, [])
    byGlyph.get(g.id).push(cp)
  }
  const ordered = [...byGlyph.entries()].sort((a, b) => a[0] - b[0])

  for (const [gid, cps] of ordered) {
    const cp = pickPrimaryCode(cps)
    const glyph = font.glyphForCodePoint(cp)
    // 跳过 glyph 0（.notdef，字体必备的缺字占位符）与 Unicode 非字符码位：
    // 这类字形不是图标；且非字符码位（如 U+FFFF）会写进字体构建的 XML，导致 fonteditor 解析中断、
    // 其后所有图标字形丢失（2026-09 实测：某参考字体解析导入后导出只剩基础字形，即此原因）
    if (gid === 0) continue
    if (isNoncharacter(cp)) continue
    if (isNotdefName(glyph.name)) continue
    // 无轮廓字形（如空格、组合用空字形）不作为图标导出
    const cmds = fontkitPathToCommands(glyph.path)
    const d = glyphToPathData(cmds, {
      unitsPerEm: font.unitsPerEm,
      ascender: font.ascent, // fontkit 2.x：font.ascent（em 顶部到 baseline 的距离）
      advanceWidth: glyph.advanceWidth
    })
    if (!d) continue

    // 命名：优先 glyph 名（CFF CharStrings 名，如 wifi-weak）；无名字或占位名
    // （glyphNN / uniXXXX / 发布版参考字体常见的 iNNN 混淆名）时用 uniXXXX 兜底
    let name = glyph.name
    if (!name || /^[gG]l?yph/i.test(name) || /^i\d+$/.test(name)) {
      name = cp > 0 ? 'uni' + cp.toString(16).toUpperCase().padStart(4, '0') : 'glyph-' + (gid + 1)
    }
    // 重名处理
    if (seenNames.has(name)) {
      let n = 2
      while (seenNames.has(`${name}_${n}`)) n++
      name = `${name}_${n}`
    }
    seenNames.add(name)

    // advanceWidth（fontkit 字体单位，仅随结果返回供参考）
    // unicodeAll：该字形在源字体中的全部码位（升序），供名称映射逐码位查名
    // aliases：主码位之外的码位，仅供预览卡片 title 提示，不进入项目数据
    result.push({
      name,
      svg: buildSvg(d, size),
      unicode: cp,
      unicodeAll: cps,
      aliases: cps.filter((c) => c !== cp),
      advanceWidth: glyph.advanceWidth
    })
  }

  return result
}

// 根据 path 数据生成统一尺寸 SVG（viewBox 1000，width/height=size）
export function buildSvg(d, size = 512) {
  const s = Number(size) || 512
  const viewBox = `0 0 1000 1000`
  // fill-rule=evenodd：内外嵌套子路径按几何挖孔，不依赖路径方向。
  // CFF/字体轮廓的方向约定与 SVG nonzero 不完全一致（opentype 解析 CFF 时方向被破坏，
  // 曾导致空心环类图标被填充成实心大圆/粗环），evenodd 对该类字体图标是正确且健壮的选择
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${s}" height="${s}" data-name="${escapeXml('')}">` +
    `<path d="${escapeXml(d)}" fill="currentColor" fill-rule="evenodd"/></svg>`
}
