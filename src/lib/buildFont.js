// 图标项目 → 字体产物（ttf/woff/woff2 + css，文件名/字体族由调用方传入 fontName）
// 码位分配在 PUA 保留区（U+EE00–U+EFFF 512 个，避开参考映射已占用的 E000–E8CC / F000+），name 表写入图标名
// GSUB 连字：输入图标名（如 trash）自动替换为图标字形
import fonteditor from 'fonteditor-core'
// woff2 编码 wasm：同 parseFont（?url + 构建内联 dataURL，供 file:// 绿色版使用）
import woff2WasmUrl from '../assets/woff2.wasm?url'
import { normalizeSvgImport, parsePathCommands, pathBBox, commandsToPathData } from './svgNormalize.js'
import { isNoncharacter, isNotdefName } from './codepointPlan.js'
import { buildBaseGlyphXml } from './baseGlyphs.js'
import { buildGsubTable, injectGsub } from './gsub.js'

export const PUA_START = 0xee00

// 从 SVG 字符串提取 path 数据（要求 d= 前不是字母，避免误匹配 id=）
export function extractPathData(svg) {
  const m = String(svg).match(/<path[^>]*\s(?:[a-zA-Z:_-]+="[^"]*"\s)*d=["']([^"']+)["']/i)
  if (!m) return ''
  return m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// 归一化 path 数据到 0~1000 的 viewBox 内（修复旧版本解析出的越界/负坐标数据）
// 若坐标已在 0~1000 内则原样返回；支持小写相对命令、紧凑格式
export function normalizePathData(d) {
  const cmds = parsePathCommands(d)
  if (!cmds.length) return d

  // 计算 bbox
  const bb = pathBBox(cmds)
  if (!isFinite(bb.minX) || !isFinite(bb.minY)) return d

  // 已经基本在 0~1000 内且全大写则不改动
  if (bb.minX >= -1 && bb.minY >= -1 && bb.maxX <= 1001 && bb.maxY <= 1001 && cmds.every((c) => c.raw === c.type)) return d

  const w = bb.maxX - bb.minX
  const h = bb.maxY - bb.minY
  if (w <= 0 || h <= 0) return d

  const s = 1000 / Math.max(w, h)
  const ox = (1000 - w * s) / 2 - bb.minX * s
  const oy = (1000 - h * s) / 2 - bb.minY * s

  return commandsToPathData(cmds, s, ox, oy)
}

// 归一化 SVG 字符串：修复 path 越界，并统一尺寸
export function normalizeSvg(svg, size = null) {
  const s = String(svg || '')
  // 先尝试完整规范化（处理小写相对命令、复杂 SVG）
  try {
    const { svg: clean, changed } = normalizeSvgImport(s, size || 1000)
    if (changed) return clean
    // 未发生结构转换，仅修复越界坐标（用 extractPathData 提取，避免误匹配 id=）
    const dm = extractPathData(s)
    if (dm) {
      const nd = normalizePathData(dm)
      if (nd !== dm) {
        // 精确替换 path 标签内的 d 属性
        const pathRe = /(<path[^>]*?\sd=)(["'])([^"']*)\2/i
        let fixed = s
        const pm = fixed.match(pathRe)
        if (pm) {
          fixed = fixed.replace(pathRe, `$1$2${nd}$2`)
        } else {
          fixed = s.replace(dm, nd)
        }
        if (size) {
          fixed = fixed.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`)
        }
        return fixed
      }
    }
    if (size) {
      return s.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`)
    }
    return s
  } catch {
    if (size) {
      return s.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`)
    }
    return s
  }
}

// 构建 TrueType 字体（fonteditor-core）
// 输出 TrueType（glyf 表）+ post 表 format 2（带字形名），保证 Word/PS 字符映射表能按名称查找
// 图标字形：SVG(y向下0~1000) 经 scale 0.8 + 翻转（y_tt = 800 - y_svg*0.8）落到 baseline 上方 0~800
// 基础拉丁字形：直接使用源字体内部 y 向上坐标（unitsPerEm=1000），不再翻转缩放
// 内置基础拉丁字形（可见 ASCII 94 字符：A-Z a-z 0-9 符号），支持 GSUB 连字（输入图标名自动替换）
// weight: 'regular'|'bold' —— 决定基础字形取自哪一套（latin-regular/bold），图标字形不受影响
// icons: [{ name, svg, code }]，code 为稳定码位（#15，图标分配后永不变）
export function buildTtfFont(icons, familyName = 'snfont', weight = 'regular') {
  const seen = new Set()
  const mapping = [] // { name, code }

  // 1. 内置基础字形（连字触发字符：字母/数字/符号，按所选字重取形：regular→常规 / bold→粗体）
  // 用户导入的图标若占用了 ASCII 码位（覆盖内置基础字形），这些码位跳过内置，避免重复 unicode
  const asciiOverrides = new Set()
  for (const icon of icons) {
    if (icon.code != null && icon.code >= 0x20 && icon.code <= 0x7e) asciiOverrides.add(icon.code)
  }
  const base = buildBaseGlyphXml(weight, asciiOverrides.size ? asciiOverrides : null)
  const glyphsXml = [base.xml]

  // 2. 图标字形
  const skipped = [] // 被防御性跳过的占位字形（仅告警，不进入字体）
  for (const icon of icons) {
    const name = String(icon.name || '').trim()
    if (!name) continue
    if (seen.has(name)) continue
    // 防御性过滤（兼容旧项目数据）：
    // · 名字为 .notdef：字体必备的缺字占位符（fonteditor 会自动创建 glyph 0），这里不能再塞一个；
    // · 码位是非字符（U+FDD0–U+FDEF / U+*FFFE / U+*FFFF）：写进 SVG 字体的 XML 会让 fonteditor
    //   解析中断，导致其后所有图标字形丢失（2026-09 实测：某参考字体解析导入后导出只剩基础字形即此原因）
    const rawCode = icon.code != null ? icon.code : null
    if (isNotdefName(name) || isNoncharacter(rawCode)) {
      skipped.push(name + (rawCode != null ? '(U+' + rawCode.toString(16).toUpperCase() + ')' : ''))
      continue
    }
    seen.add(name)

    // 稳定码位（#15）：图标分配后永久固定
    const code = icon.code != null ? icon.code : PUA_START

    // 规范化 SVG，提取 path 数据（含空字形占位：解析失败也给空 path）
    let d = ''
    try {
      const clean = normalizeSvg(icon.svg, 1000)
      d = extractPathData(clean)
      // y 翻转 + 缩放到 0~800（SVG y 向下 0~1000 → TrueType y 向上 0~800）
      d = flipYToFontSpace(d, 0.8, 800)
    } catch {
      d = ''
    }
    // SVG 字体格式里 d 为空 = 空字形，仍保留 glyph-name 和 unicode
    glyphsXml.push(`<glyph glyph-name="${escapeXml(name)}" unicode="&#x${code.toString(16)};" d="${escapeXml(d)}"/>`)
    mapping.push({ name, code })
  }

  const svgFont = `<svg xmlns="http://www.w3.org/2000/svg">
<defs><font id="${familyName}" horiz-adv-x="1000">
<font-face font-family="${familyName}" units-per-em="1000" ascent="800" descent="-200"/>
${glyphsXml.join('\n')}
</font></defs>
</svg>`

  if (skipped.length) {
    // 仅告警不阻断：被跳过的都是无意义的占位字形（.notdef / 非字符码位）
    console.warn('[buildFont] 已跳过 ' + skipped.length + ' 个占位字形（不进入字体）：' + skipped.slice(0, 5).join(', ') + (skipped.length > 5 ? ' …' : ''))
  }

  // 3. 构建 ttf
  const ttfObj = fonteditor.svg2ttfobject(svgFont, { combinePath: false })

  // 4. 建立字符→glyphId 映射（基础字形 + 图标），生成 GSUB 连字
  const charToGlyphId = {}
  // 基础字形：glyph name 是 latin-N（N 为字符索引）
  const baseChars = Object.keys(base.map)
  ttfObj.glyf.forEach((g, idx) => {
    if (g.name && g.name.startsWith('latin-')) {
      const i = parseInt(g.name.slice(6), 10)
      const ch = baseChars[i]
      if (ch != null) charToGlyphId[ch] = idx
    }
  })
  // 图标字形：name → glyphId
  const iconNameToId = {}
  ttfObj.glyf.forEach((g, idx) => {
    if (g.name && !g.name.startsWith('latin-') && g.name !== '.notdef') {
      iconNameToId[g.name] = idx
    }
  })


  // 被覆盖的基础字符（ASCII 覆盖）：该字符的连字输入映射指向用户图标字形
  // 背景：内置字形被跳过时 base.map 不含该字符，若不补映射，含该字符的图标名在 GSUB
  // 中无法解析出输入序列 → 连字失效（2026-09 实测修复：覆盖 a/b/c 后 GSUB 全挂）
  for (const icon of icons) {
    const code = icon.code != null && typeof icon.code !== 'number' ? parseInt(String(icon.code), 16) : icon.code
    if (code != null && !isNaN(code) && code >= 0x20 && code <= 0x7e) {
      const id = iconNameToId[String(icon.name || '').trim()]
      if (id != null) charToGlyphId[String.fromCharCode(code)] = id
    }
  }

  // 生成连字规则：每个图标名 → 图标 glyphId
  const ligatures = mapping
    .filter((m) => iconNameToId[m.name] != null)
    .map((m) => ({ name: m.name, glyphId: iconNameToId[m.name] }))

  const gsub = buildGsubTable(ligatures, charToGlyphId)

  // 5. 修正 name 表：svg2ttfobject 仅设置 fontFamily，其余(fullName/子族/唯一标识/postScriptName)
  //    残留 fonteditor 默认值 → Windows 字体"属性-详细信息-标题"会显示 fonteditor。
  //    这里全部改为字体名：fullName=字体名（标题），fontSubFamily=Regular/Bold
  ttfObj.name.fontFamily = familyName
  ttfObj.name.fontSubFamily = weight === 'bold' ? 'Bold' : 'Regular'
  ttfObj.name.uniqueSubFamily = `${familyName} ${weight === 'bold' ? 'Bold' : 'Regular'}`
  ttfObj.name.fullName = familyName
  ttfObj.name.version = 'Version 1.0'
  ttfObj.name.postScriptName = familyName

  // 6. 写 ttf，注入 GSUB
  const feFont = fonteditor.createFont(ttfObj)
  const plainTtf = feFont.write({ type: 'ttf', toBuffer: false })
  const ttfBuffer = gsub ? injectGsub(plainTtf, gsub) : plainTtf

  return { ttfBuffer, mapping }
}

// 将 SVG 的 y 向下坐标翻转为 TrueType 的 y 向上，并缩放到 [0, yBase] 区间
// 输入 d 坐标：x∈[0,1000] y∈[0,1000]（y 向下）；输出：x∈[0,1000*scale] y∈[0,yBase]（y 向上）
function flipYToFontSpace(d, scale = 0.8, yBase = 800) {
  return d.replace(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g, (m, x, y) => {
    const nx = +(parseFloat(x) * scale).toFixed(2)
    const ny = +(yBase - parseFloat(y) * scale).toFixed(2)
    return `${nx} ${ny}`
  })
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  })
}

// ttf ArrayBuffer → woff ArrayBuffer（fonteditor-core）
export function ttfToWoff(ttfBuffer) {
  return fonteditor.ttf2woff(ttfBuffer)
}

let woff2Ready = null
// 初始化 woff2 wasm（浏览器端）
export async function ensureWoff2Ready() {
  if (!woff2Ready) {
    woff2Ready = fonteditor.woff2.init(woff2WasmUrl)
  }
  await woff2Ready
}

// ttf ArrayBuffer → woff2（Uint8Array）
export async function ttfToWoff2(ttfBuffer) {
  await ensureWoff2Ready()
  return fonteditor.woff2.encode(ttfBuffer)
}

// 生成 snfont.css
// 类名前缀固定为 sn-（如 .sn-trash），font-family 用 familyName（已含字重后缀）
// weight: 'regular'|'bold' → @font-face 声明对应字重；图标类本身保持 normal（图标字形单字重，不受加粗影响）
export function buildCss(mapping, familyName = 'snfont', classPrefix = 'sn-', weight = 'regular') {
  const wVal = weight === 'bold' ? 700 : 400
  const lines = []
  lines.push(`@font-face {`)
  lines.push(`  font-family: '${familyName}';`)
  lines.push(`  src: url('./${familyName}.woff2') format('woff2'),`)
  lines.push(`       url('./${familyName}.woff') format('woff'),`)
  lines.push(`       url('./${familyName}.ttf') format('truetype');`)
  lines.push(`  font-weight: ${wVal};`)
  lines.push(`  font-style: normal;`)
  lines.push(`  font-display: block;`)
  lines.push(`}`)
  lines.push('')
  lines.push(`[class^="${classPrefix}"], [class*=" ${classPrefix}"] {`)
  lines.push(`  font-family: '${familyName}' !important;`)
  lines.push(`  speak: none;`)
  lines.push(`  font-style: normal;`)
  lines.push(`  font-weight: normal;`)
  lines.push(`  font-variant: normal;`)
  lines.push(`  text-transform: none;`)
  lines.push(`  line-height: 1;`)
  lines.push(`  -webkit-font-smoothing: antialiased;`)
  lines.push(`  -moz-osx-font-smoothing: grayscale;`)
  // #3：启用 GSUB 连字（输入图标名自动替换）
  lines.push(`  font-feature-settings: "liga" on;`)
  lines.push(`}`)
  lines.push('')
  for (const item of mapping) {
    const code = item.code.toString(16).toUpperCase()
    lines.push(`.${classPrefix}${item.name}:before {`)
    lines.push(`  content: "\\${code}";`)
    lines.push(`}`)
    lines.push('')
  }
  return lines.join('\n')
}

// 构建整个字体包：ttf/woff/woff2 的 ArrayBuffer 集合
// weight: 'regular'|'bold'。产物字体名/文件名统一为 familyName + ('-regular' / '-bold')，
// 常规/粗体文件名不同 → 可同装不冲突；图标名、unicode、css 类名均与字重无关，保持不变
export async function buildFontFiles(icons, familyName = 'snfont', classPrefix = 'sn-', weight = 'regular') {
  const fullName = weight === 'bold' ? `${familyName}-bold` : `${familyName}-regular`
  const { ttfBuffer, mapping } = buildTtfFont(icons, fullName, weight)
  const woffBuffer = ttfToWoff(ttfBuffer)
  const woff2Bytes = await ttfToWoff2(ttfBuffer)
  const css = buildCss(mapping, fullName, classPrefix, weight)
  return { ttf: ttfBuffer, woff: woffBuffer, woff2: woff2Bytes, css, mapping, fullName, weight }
}