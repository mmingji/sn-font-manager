// zip 打包与下载
import JSZip from 'jszip'
import fileSaver from 'file-saver'
import { buildFontFiles } from './buildFont.js'
import { groupIcons } from '../store/project.js'

// 兼容浏览器(Vite)与 Node 环境
const saveAs = fileSaver.saveAs || fileSaver.default?.saveAs || fileSaver

function downloadBlob(blob, filename) {
  saveAs(blob, filename)
}

// 批量导出 svg 为 zip
// icons: [{ name, svg }]，svg 内已有 width/height=size
export async function exportSvgZip(icons, size, zipName = 'svgs.zip') {
  const zip = new JSZip()
  const folder = zip.folder('svgs')
  for (const icon of icons) {
    // 确保 svg 尺寸统一
    let svg = icon.svg
    if (size) {
      svg = svg
        .replace(/width="[^"]*"/, `width="${size}"`)
        .replace(/height="[^"]*"/, `height="${size}"`)
    }
    folder.file(`${icon.name}.svg`, svg)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, zipName)
}

// 导出完整项目包：<字体名>.ttf/woff/woff2 + <字体名>.css + demo.html + <项目名>.project.json（文件名跟随项目/字体名）
// withSvg 控制是否附带 svgs 文件夹（默认不附带，减小体积）
// project: { name, fontName, classPrefix, weight, icons, svgSize }
// 下载包内所有文件放在 zip 根目录下以产物字体名命名的文件夹里（如 <字体名>-regular/ 或 <字体名>-bold/），避免散落根目录
export async function exportProjectZip(project, size, withSvg = false) {
  const fontName = project.fontName || 'snfont'
  const classPrefix = project.classPrefix || 'sn-'
  const weight = project.weight || 'regular'
  const { ttf, woff, woff2, css, mapping, fullName } = await buildFontFiles(project.icons, fontName, classPrefix, weight)

  const zip = new JSZip()
  // 内建产物文件夹：<fullName>/（常规 <字体名>-regular/，粗体 <字体名>-bold/）
  const root = zip.folder(fullName)
  const name = fullName
  const cssName = `${name}.css`

  if (withSvg) {
    const folder = root.folder('svgs')
    for (const icon of project.icons) {
      let svg = icon.svg
      svg = svg
        .replace(/width="[^"]*"/, `width="${size}"`)
        .replace(/height="[^"]*"/, `height="${size}"`)
      folder.file(`${icon.name}.svg`, svg)
    }
  }

  root.file(`${name}.ttf`, ttf)
  root.file(`${name}.woff`, woff)
  root.file(`${name}.woff2`, woff2)
  root.file(cssName, css)
  root.file('demo.html', buildDemoHtml({ ...project, weight }, mapping, cssName, classPrefix, fullName))
  const projectJsonName = (project.name || 'project').trim().replace(/[\\/:*?"<>|]/g, '_')
  root.file(projectJsonName + '.project.json', JSON.stringify({ ...project, weight }, null, 2))

  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${fullName}-project.zip`)
}

// 生成本地预览页 demo.html
// #16：图标用纯字体渲染（<i class="{prefix}xxx">，prefix 由参数传入），不内嵌 SVG，PS 里可直接复制
// #17：按首字母分组 + 搜索
// #18：@font-face 用 src 相对引用（不内联字体）
// #19：点击名称/unicode/类名复制 + Toast
// #3：页面顶部显示当前字重；布局撑满视口、右侧字母导航垂直居中并加粗
// demo 标题：页面 title 固定品牌「SnFont 图标预览」；h1 图标库名跟随项目名（默认 snfont→SnFont，自定义原样）
// demo.html 单文件自带 favicon：内联 Sn SVG（data URI），下载后无外部文件也能显示页签图标
const DEMO_FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3b82f6"/><text x="32" y="43" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">Sn</text></svg>'
const DEMO_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(DEMO_FAVICON_SVG)

export function buildDemoHtml(project, mapping, cssName, classPrefix = 'sn-', fontFamilyArg) {
  const icons = project.icons
  const weight = project.weight || 'regular'
  const weightLabel = weight === 'bold' ? 'Bold 粗体' : 'Regular 常规'
  const rawName = project.name || 'snfont'
  const projectTitle = rawName === 'snfont' ? 'SnFont' : rawName
  // fontFamily 用构建产物名（已含 -regular/-bold 后缀），如未传则回退 fontName
  const fontFamily = fontFamilyArg || project.fontName || project.name || 'snfont'

  // 按首字母分组（#17）：与主管理页一致，中文按拼音首字母（groupIcons 已处理排序）
  const groups = groupIcons(icons)
  const codeById = {}
  for (const item of mapping) codeById[item.name] = item.code

  // #16/#7：纯字体渲染，图标为真实 unicode 文本（可选中复制到 PS）
  const groupHtml = groups.map((g) => {
    const items = g.icons.map((icon) => {
      const code = codeById[icon.name]
      const codeHex = code != null ? code.toString(16).toUpperCase().padStart(4, '0') : '—'
      const cls = `${classPrefix}${icon.name}`
      // 真实 unicode 字符作为文本（#7 可选中复制）
      const uniChar = code != null ? String.fromCodePoint(code) : ''
      // data-code：码位 hex（大写，与 .code 显示一致）写在卡片 div 上，供页内搜索按 unicode 过滤；无码位时留空
      return `<div class="item" data-name="${icon.name}" data-code="${code != null ? codeHex : ''}">
  <i class="${cls}">${uniChar}</i>
  <!-- 超长省略号截断；完整名 hover 显示（title） -->
  <div class="name" data-copy="${icon.name}" title="${icon.name}">${icon.name}</div>
  <div class="code" data-copy="${codeHex}">${codeHex}</div>
  <code class="cls" data-copy=".${cls}" title=".${cls}">.${cls}</code>
</div>`
    }).join('\n')
    return `<section class="group" data-group="${g.key}">
  <h2 class="group-title"><span class="letter">${g.key}</span><span class="count">${g.icons.length}</span></h2>
  <div class="cards">${items}</div>
</section>`
  }).join('\n')

  const indexBar = groups.map((g) => `<button data-target="${g.key}">${g.key}</button>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SnFont 图标预览</title>
<link rel="icon" href="${DEMO_FAVICON}" />
<style>
@font-face {
  font-family: '${fontFamily}';
  src: url('./${cssName.replace('.css', '.woff2')}') format('woff2'),
       url('./${cssName.replace('.css', '.woff')}') format('woff'),
       url('./${cssName.replace('.css', '.ttf')}') format('truetype');
  font-weight: ${weight === 'bold' ? 700 : 400};
  font-style: normal;
  font-display: block;
}
[class^="${classPrefix}"], [class*=" ${classPrefix}"] {
  font-family: '${fontFamily}' !important;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "liga" on;
}
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif; margin: 0; background: #f5f6fa; color: #1f2329; }
  /* #6：header 为 flex，标题左、搜索右 */
  header { padding: 20px 32px; background: #fff; border-bottom: 1px solid #e4e7ee; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
  .header-left h1 { margin: 0; font-size: 20px; }
  .header-left p { margin: 6px 0 0; color: #6b7280; font-size: 13px; }
  .search-wrap input { width: 280px; max-width: 100%; padding: 8px 12px; border: 1px solid #e4e7ee; border-radius: 8px; font-size: 14px; outline: none; }
  .search-wrap input:focus { border-color: #3b82f6; }
  /* #5：整体 flex 列布局占满视口，内容区 .content 撑满剩余高度；.groups 在剩余空间内滚动 */
  body, html { height: 100%; }
  body { display: flex; flex-direction: column; }
  header { flex-shrink: 0; }
  .content { flex: 1; min-height: 0; display: flex; padding: 16px 32px 24px; }
  .groups { flex: 1; min-width: 0; overflow-y: auto; padding-right: 12px; scroll-behavior: smooth; }
  .groups::-webkit-scrollbar { width: 8px; }
  .groups::-webkit-scrollbar-thumb { background: #c9cfdb; border-radius: 4px; }
  .groups::-webkit-scrollbar-thumb:hover { background: #aab3c5; }
  .group { margin-bottom: 20px; }
  .group-title { display: flex; align-items: center; gap: 10px; font-size: 14px; margin: 0 0 10px; color: #6b7280; position: sticky; top: 0; background: #f5f6fa; padding: 6px 0; }
  .letter { width: 26px; height: 26px; border-radius: 6px; background: #3b82f6; color: #fff; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .count { font-size: 12px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
  .item { background: #fff; border: 1px solid #e4e7ee; border-radius: 10px; padding: 20px 12px; text-align: center; cursor: pointer; transition: all .15s; }
  .item:hover { border-color: #3b82f6; box-shadow: 0 4px 12px rgba(59,130,246,.15); }
  /* #7：图标为真实文本，允许鼠标选中复制 */
  .item i { font-size: 40px; color: #333; display: inline-block; font-style: normal; user-select: text; -webkit-user-select: text; cursor: text; }
  /* 超长省略号截断；完整名 hover 显示（title） */
  .item .name { margin-top: 12px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
  .item .code { font-size: 12px; color: #9ca3af; margin-top: 4px; font-family: Consolas, monospace; cursor: pointer; }
  .item .cls { display: block; margin-top: 6px; font-size: 12px; color: #3b82f6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f0f4ff; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
  /* #5：右侧字母导航：撑满高度容器内垂直居中 + 加粗加大 */
  .index-bar { flex-shrink: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; margin-left: 12px; padding: 0 4px; }
  .index-bar button { border: none; background: transparent; color: #4b5563; font-size: 15px; font-weight: 700; padding: 3px 7px; line-height: 1.2; cursor: pointer; border-radius: 4px; }
  .index-bar button:hover { color: #3b82f6; background: #eef4ff; }
  .toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: rgba(31,35,41,.9); color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity .25s; pointer-events: none; z-index: 999; }
  .toast.show { opacity: 1; }
  .font-warn { display: none; background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; padding: 10px 16px; border-radius: 8px; margin: 12px 32px 0; font-size: 13px; }
</style>
</head>
<body>
<header>
  <div class="header-left">
    <h1>${projectTitle} 图标库</h1>
    <p>共 ${icons.length} 个图标 · 字重：${weightLabel} · 安装 ${fontFamily}.ttf 后：字符映射表按名称插入，或直接输入图标名（GSUB 连字自动替换）</p>
  </div>
  <!-- #6：搜索入标题栏 -->
  <div class="search-wrap"><input id="search" type="text" placeholder="搜索名称或 unicode…"></div>
</header>
<div class="font-warn" id="fontWarn">⚠️ 字体未加载成功。若使用 Chrome 直接双击打开（file://），外部字体可能被拦截，请用本地服务器打开：<code>npx serve</code> 或使用 Firefox。</div>
<div class="content">
  <div class="groups" id="groups">
${groupHtml}
  </div>
  <nav class="index-bar" id="indexBar">
${indexBar}
  </nav>
</div>
<div class="toast" id="toast"></div>
<script>
  // #19：点击复制
  var toast = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 1500);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() { showToast('已复制: ' + text); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      showToast('已复制: ' + text);
    }
  }
  document.querySelectorAll('[data-copy]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      copyText(el.getAttribute('data-copy'));
    });
  });

  // #17：搜索过滤（支持名称 + unicode 码位）
  // 码位 hex 取自卡片 div 的 data-code（大写，如 F04B）；小写化后同时匹配
  // f04b / F04B / u+f04b 几种输入形式；无码位（data-code 为空）的卡片只按名称匹配
  var search = document.getElementById('search');
  search.addEventListener('input', function() {
    var kw = search.value.trim().toLowerCase();
    document.querySelectorAll('.group').forEach(function(g) {
      var show = false;
      g.querySelectorAll('.item').forEach(function(item) {
        var name = (item.getAttribute('data-name') || '').toLowerCase();
        var hex = (item.getAttribute('data-code') || '').toLowerCase();
        var hit = !kw || name.includes(kw) || (!!hex && (hex.includes(kw) || ('u+' + hex).includes(kw)));
        item.style.display = hit ? '' : 'none';
        if (hit) show = true;
      });
      g.style.display = show ? '' : 'none';
    });
  });

  // 字母索引跳转
  document.getElementById('indexBar').querySelectorAll('button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.getAttribute('data-target');
      var el = document.querySelector('.group[data-group="' + target + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // 字体加载检测
  if (document.fonts && document.fonts.check) {
    var check = function() {
      var loaded = document.fonts.check('16px "${fontFamily}"');
      document.getElementById('fontWarn').style.display = loaded ? 'none' : 'block';
    };
    document.fonts.ready.then(check);
    setTimeout(check, 2000);
  }
</script>
</body>
</html>`
}
