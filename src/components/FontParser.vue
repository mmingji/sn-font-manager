<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { parseFontFile, isFontFile } from '../lib/parseFont'
import { exportSvgZip } from '../lib/zip'
import { useProjectStore } from '../store/project'
import { parseUnicodeMap, applyUnicodeNameMap, loadBuiltinMap, resolveMappedName } from '../lib/unicodeMap'
import { isBaseAscii } from '../lib/codepointPlan'

// imported：导入完成通知父级（App 收到后立即执行异常 SVG 检查与修复，无需等下次刷新）
const emit = defineEmits(['close', 'imported'])
const store = useProjectStore()

// 空状态快捷上传传入的字体文件：挂载后自动开始解析（无需用户再点选择）
const props = defineProps({
  initialFile: { type: Object, default: null }
})

const SVG_SIZES = [128, 512, 1024]

const dragging = ref(false)
const fileInput = ref(null)
const parsing = ref(false)
const error = ref('')
const warning = ref('')
const parsed = ref([]) // { name, svg, unicode, advanceWidth }
// 当前大预览字形下标：-1 = 尚未点击任何卡片（大预览默认隐藏，点卡片后才出现并把网格往下推）
const currentIdx = ref(-1)
const currentItem = computed(() => {
  if (currentIdx.value < 0 || currentIdx.value >= parsed.value.length) return null
  return parsed.value[currentIdx.value]
})
// 大预览角标取解析产物 svg 的 width（解析设置里选的尺寸，如 512/1024/custom）
function svgWidth(svg) {
  const m = String(svg).match(/width="([^"]+)"/)
  return m ? m[1] : '—'
}
const size = ref(512)
const customSize = ref('')
const selected = ref(new Set())
// ASCII 基础区(0x20-0x7E)冲突字形下标集合：与内置字母/数字/符号同码位，保持原码位会导致字体构建报错
const conflictIndices = ref(new Set())
// 冲突处理模式：''（未选） | 'auto'（自动分配） | 'remove'（移除冲突） | 'overwrite'（覆盖旧图标）
// 有冲突时必须三选一才能导入；默认都不选
const conflictMode = ref('')
// #7：保持原字体 unicode 码（#8：默认选中）
const keepUnicode = ref(true)
// #8：unicode→名称映射
const showMap = ref(false)
const mapText = ref('')          // 输入框内手动粘贴的映射
const mapStatus = ref('')        // 提示文案（应用后显示条数）
// 映射数据文件名：开发版与构建版统一使用 public/unicode-map.data.js（内容即 JSON）
// 点击链接可直接打开编辑，保存后刷新页面即生效（详见 lib/unicodeMap.js 的数据来源说明）
const mapFileName = 'unicode-map.data.js'
const builtinMap = ref({})       // 从映射文件读取到的映射（{hex: name}），未应用前不生效
const builtinLoaded = ref(false)
const unicodeNameMap = ref({})   // 已应用的合并映射（映射文件 + 输入框粘贴），用于解析补名

const fileInfo = ref(null)

// 挂载时读取映射文件（仅计数，不应用；点"应用映射"才生效）
onMounted(async () => {
  const map = await loadBuiltinMap()
  if (Object.keys(map).length) {
    builtinMap.value = map
    builtinLoaded.value = true
  }
  // 空状态快捷上传的字体：直接进入解析流程
  if (props.initialFile) handleFiles([props.initialFile])
})

function onDrop(e) {
  dragging.value = false
  const files = [...(e.dataTransfer?.files || [])]
  handleFiles(files)
}

function onSelect(e) {
  handleFiles([...(e.target.files || [])])
}

async function handleFiles(files) {
  const fontFile = files.find(isFontFile)
  if (!fontFile) {
    error.value = '请选择 ttf / otf / woff / woff2 格式的字体文件'
    return
  }
  error.value = ''
  warning.value = ''
  parsing.value = true
  parsed.value = []
  selected.value = new Set()
  currentIdx.value = -1 // 重解析重置：等待重新点击卡片再展示大预览
  try {
    // 文件过大预警（>10MB 可能解析失败或极慢，但不阻断）
    if (fontFile.size > 10 * 1024 * 1024) {
      warning.value = '⚠️ 文件超过 10MB，可能解析失败或耗时较长'
    }
    let icons = await parseFontFile(fontFile, size.value)
    // 字形数过多预警（>5000 不阻断）
    if (icons.length > 5000) {
      warning.value = (warning.value ? warning.value + '；' : '') + `字形数达 ${icons.length}（>5000），可能耗时较长或超出部分系统限制`
    }
    if (!icons.length) {
      error.value = '解析结果为空：该字体没有可导出的字形（可能全是空格/组合字符，或无轮廓字形）'
      return
    }
    // #8：若有映射表，给无名字的字形补名
    if (Object.keys(unicodeNameMap.value).length) {
      icons = applyUnicodeNameMap(icons, unicodeNameMap.value)
    }
    parsed.value = icons
    fileInfo.value = { name: fontFile.name, count: icons.length }
    selected.value = new Set(icons.map((_, i) => i))
    // 计算码位冲突（仅保持原 unicode 时生效；不保持则自动分配会跳过已占用码位，不会撞）
    // 冲突 = 与内置基础字符同码位(ASCII 0x20-0x7E) ∪ 与项目已有图标占用码位相同。
    // 按该字形全部码位（unicodeAll）判定：一个字形的旁路码位若落在内置区（如感叹号
    // 同时占 0021 与 F12A），只导主码位 F12A 会与内置 0021 形成双字形，必须纳入冲突
    // 让用户三选一（2026-09 实测反馈）
    const conf = new Set()
    if (keepUnicode.value) {
      const usedCodes = new Set(store.icons.map((ic) => ic.code))
      icons.forEach((it, i) => {
        if (it.unicode == null) return
        const codes = it.unicodeAll && it.unicodeAll.length ? it.unicodeAll : [it.unicode]
        if (codes.some(isBaseAscii) || codes.some((c) => usedCodes.has(c))) conf.add(i)
      })
    }
    conflictIndices.value = conf
    conflictMode.value = '' // 重解析后重置冲突处理选择
  } catch (e) {
    // #6：解析失败原因回显
    error.value = '解析失败：' + (e?.message || e)
  } finally {
    parsing.value = false
  }
}

function toggleSelect(i) {
  // 整体替换 Set 引用而非原地增删：Vue 3 的 ref 不追踪 Set 内部变化，否则 :class 不刷新
  const next = new Set(selected.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  selected.value = next
}
function toggleAll() {
  // 全选/取消全选：整体替换 Set 引用（同上理由，保证 :class 响应式更新）
  selected.value = selected.value.size === parsed.value.length
    ? new Set()
    : new Set(parsed.value.map((_, i) => i))
}


// 监听冲突模式：选「移除冲突」立即取消全部冲突字形勾选（卡片同时禁用不可点）
watch(conflictMode, (mode) => {
  if (mode === 'remove' && conflictIndices.value.size) {
    const next = new Set(selected.value)
    for (const i of conflictIndices.value) next.delete(i)
    selected.value = next
  }
})

const exportable = computed(() =>
  parsed.value.filter((_, i) => selected.value.has(i))
)

async function downloadSvgs() {
  const icons = exportable.value.map((p) => ({ name: p.name, svg: p.svg }))
  await exportSvgZip(icons, size.value, `${store.fontName}-svgs.zip`)
}

// 底部「导入项目」：按冲突处理模式分发
// - 无冲突：直接导入全部选中项
// - auto：冲突字形码位改为自动分配后导入（只针对已勾选冲突项）
// - remove：移除全部冲突字形（冲突项自动取消勾选），导入其余
// - overwrite：已勾选冲突字形覆盖同码位旧图标/内置基础字形，未勾选冲突项不导入
function importToProject() {
  if (!conflictIndices.value.size) {
    doImport(null)                 // 无冲突：全部选中项
    return
  }
  switch (conflictMode.value) {
    case 'auto':
      doAutoAssign()
      break
    case 'remove':
      doRemoveConflicts()
      break
    case 'overwrite':
      doOverwrite()
      break
    default:
      // 不应发生：按钮在未选模式时已禁用
      return
  }
}

// ① 自动分配：已勾选的冲突字形去掉原码位（走 store 自动分配），其余选中项照常导入
function doAutoAssign() {
  const items = exportable.value.map((p) => {
    const isConflict = conflictIndices.value.has(parsed.value.indexOf(p))
    return {
      name: p.name,
      svg: p.svg,
      // 冲突项不传码位 → store 自动分配；非冲突项仍保持原码位
      code: keepUnicode.value && !isConflict && p.unicode != null ? p.unicode : null
    }
  })
  commitImport(items)
}

// ② 移除冲突：取消全部冲突字形勾选（卡片在 remove 模式下禁用不可点），只导入其余选中项
function doRemoveConflicts() {
  const keepIdx = []
  let exp = 0
  for (let i = 0; i < parsed.value.length; i++) {
    if (conflictIndices.value.has(i)) {
      // 取消该冲突项勾选
      selected.value = new Set([...selected.value].filter((x) => x !== i))
      continue
    }
    if (selected.value.has(i)) keepIdx.push(exp)
    exp++
  }
  const items = exportable.value.filter((_, k) => keepIdx.includes(k)).map((p) => ({
    name: p.name,
    svg: p.svg,
    code: keepUnicode.value && p.unicode != null ? p.unicode : null
  }))
  commitImport(items)
}

// 覆盖导入时冲突项落哪个码位：优先撞项目旧图标的码位（同码位覆盖，旧图标被替换），
// 其次字形旁路码位里的内置 ASCII 码位（覆盖内置基础字符，避免一个字形两份轮廓），
// 最后主码位。数据来源：parseFontFile 的 unicodeAll（该字形在源字体中的全部码位）
function pickOverwriteCode(p) {
  const codes = p.unicodeAll && p.unicodeAll.length ? p.unicodeAll : [p.unicode]
  const usedCodes = new Set(store.icons.map((ic) => ic.code))
  const hitUsed = codes.find((c) => usedCodes.has(c))
  if (hitUsed != null) return hitUsed
  const ascii = codes.find(isBaseAscii)
  if (ascii != null) return ascii
  return p.unicode
}

// ③ 覆盖旧图标：冲突项（已勾选）用同码位覆盖项目旧图标/替换内置基础字形，
// 未勾选的冲突项不导入；非冲突项照常导入
function doOverwrite() {
  const conflictItems = []
  const normalItems = []
  for (const p of exportable.value) {
    const isConflict = conflictIndices.value.has(parsed.value.indexOf(p))
    const item = {
      name: p.name,
      svg: p.svg,
      // 冲突项按 pickOverwriteCode 落码位（可能覆盖内置 ASCII 码位），非冲突项保持主码位
      code: keepUnicode.value && p.unicode != null
        ? (isConflict ? pickOverwriteCode(p) : p.unicode)
        : null
    }
    if (isConflict) conflictItems.push(item)
    else normalItems.push(item)
  }
  if (conflictItems.length) {
    const res = store.overwriteByCode(conflictItems)
    if (res.overflow) alert(res.overflow)
  }
  if (normalItems.length) {
    const res = store.addIcons(normalItems)
    if (res.overflow) alert(res.overflow)
  }
  emit('close')
}

// 统一导入：items 为 [{ name, svg, code }]，按 keepUnicode 生成后入库
function commitImport(items) {
  if (!items.length) {
    alert('没有可导入的图标')
    emit('close')
    return
  }
  const res = store.addIcons(items)
  if (res.overflow) alert(res.overflow)
  emit('imported') // 通知父级：新数据入库后立即做一次异常检查/修复
  emit('close')
}

// [兼容旧调用] 保留 doImport 供其它入口使用（无冲突时导入全部选中）
function doImport(indices) {
  const src = indices == null
    ? exportable.value
    : exportable.value.filter((_, i) => indices.has(i))
  if (!src.length) {
    alert('没有可导入的图标（冲突字形已全部移除）')
    emit('close')
    return
  }
  const items = src.map((p) => ({
    name: p.name,
    svg: p.svg,
    code: keepUnicode.value && p.unicode != null ? p.unicode : null
  }))
  const res = store.addIcons(items)
  if (res.overflow) alert(res.overflow)
  emit('imported')
  emit('close')
}

// #8：应用映射（点击按钮后，把文件映射 + 输入框映射合并应用，用于解析补名）
// mapStatus 显示「真实生效条数」——该字形最终名称能按自身码位（含别名码位）在映射表中
// 找到出处的个数；未命中映射的（保留字体原名或 glyph-N 兜底）不计入。
// 之前显示的是映射文件总条数（约 4300），与本次解析实际用上多少条无关，易误导
function applyMap() {
  const merged = { ...builtinMap.value }
  const pasted = parseUnicodeMap(mapText.value)
  Object.assign(merged, pasted) // 输入框粘贴覆盖映射文件
  if (!Object.keys(merged).length) {
    mapStatus.value = '未找到有效映射：请确认映射文件 unicode-map.data.js 存在且格式正确'
    return
  }
  unicodeNameMap.value = merged
  const pasteN = Object.keys(pasted).length
  const totalN = Object.keys(merged).length
  // 已解析的图标按最新映射重新补名
  if (parsed.value.length) {
    parsed.value = applyUnicodeNameMap(parsed.value, unicodeNameMap.value)
    // 统计真实生效：最终名称 == 按自身码位解析出的名称（映射表优先 + AGL 兜底），
    // 才说明这个名字来自命名链路；未命中的（保留字体原名或 glyph-N 兜底）不计入
    let applied = 0
    for (const p of parsed.value) {
      const codes = Array.isArray(p.unicodeAll) && p.unicodeAll.length
        ? p.unicodeAll
        : (p.unicode != null ? [p.unicode] : [])
      if (codes.some((c) => resolveMappedName(c, merged) === p.name)) applied++
    }
    mapStatus.value = '已应用映射：' + applied + ' 个字形获得映射名称'
      + '（映射表共 ' + totalN + ' 条' + (pasteN ? '，含输入框 ' + pasteN + ' 条' : '') + '）'
  } else {
    // 还没解析字体：映射先就绪，解析时自动应用（此刻无从统计生效数）
    mapStatus.value = '映射已就绪：共 ' + totalN + ' 条，解析字体后自动应用'
  }
}

// #11：预览里改名
function renameItem(i) {
  const newName = prompt('输入新名称：', parsed.value[i].name)
  if (newName && newName.trim()) {
    parsed.value[i].name = newName.trim()
  }
}

function miniSvg(svg) {
  return svg
    .replace(/width="[^"]*"/, 'width="32"')
    .replace(/height="[^"]*"/, 'height="32"')
}

// 卡片码位的 title 文案：源字体中同一字形占有的其它码位（别名），仅提示不导入
// 数据来源：parseFontFile 返回项的 aliases（主码位之外的码位，升序）
function aliasTip(item) {
  const list = item.aliases || []
  if (!list.length) return ''
  return '源字体中该字形还占有：' + list.map((c) => 'U+' + c.toString(16).toUpperCase().padStart(4, '0')).join('、') + '（不导入，仅参考）'
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal" :class="{ wide: parsed.length }">
      <header>
        <h3>解析字体文件</h3>
        <button class="close" @click="emit('close')" title="关闭">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <div class="body">
        <!-- 选择字体虚线框：上半=解析前设置操作；下半=文件选择区（浅灰可点，仅此区域触发选择） -->
        <div
          class="dropzone"
          :class="{ dragging, hasFile: parsed.length || parsing }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <input ref="fileInput" type="file" accept=".ttf,.otf,.woff,.woff2" hidden @change="onSelect" />
          <!-- 上半：解析前操作（SVG尺寸 / 名称映射表 / 保持原 unicode） -->
          <div class="dz-settings">
            <label class="size-field">
              <span>SVG 尺寸</span>
              <div class="size-row">
                <select v-model="size">
                  <option v-for="s in SVG_SIZES" :key="s" :value="s">{{ s }} × {{ s }}</option>
                  <option value="custom">自定义</option>
                </select>
                <input v-if="size === 'custom'" v-model="customSize" class="custom-size" type="number" min="16" max="2048" placeholder="如 256" />
              </div>
            </label>
            <button class="map-btn" @click="showMap = !showMap" type="button" :class="{ active: showMap }">名称映射表</button>
            <label class="keep-unicode" title="#7：导入时保持原字体的 unicode 码位">
              <input type="checkbox" v-model="keepUnicode" />
              保持原字体 unicode
            </label>
          </div>
          <!-- 下半：文件选择提示（浅灰背景；只有这里可点击选择，解析前设置不干扰） -->
          <div class="dz-pick" @click="fileInput.click()">
            <p v-if="parsing">解析中…</p>
            <p v-else-if="parsed.length">已解析：{{ fileInfo?.name }}（{{ fileInfo?.count }} 个字形）</p>
            <p v-else>拖入字体文件，或点击选择<br /><small>支持 ttf / otf / woff / woff2</small></p>
            <p class="dz-reselect" v-if="parsed.length || fileInfo">点击可重新选择字体</p>
          </div>
        </div>

        <!-- #8：unicode→名称 映射表（虚线框下方独立展开） -->
        <div v-if="showMap" class="map-box">
          <p class="map-desc">
            <template v-if="builtinLoaded">
              映射文件 <a :href="'./' + mapFileName" target="_blank" class="map-file-link" title="点击打开该配置文件，编辑保存后刷新页面即生效">{{ mapFileName }}</a>
              （读取到 {{ Object.keys(builtinMap).length }} 条映射关系），点击下方「应用映射」后生效，解析字形时自动命名。<br />
            </template>
            也可在下方输入框粘贴映射内容补充/覆盖。<small>格式示例：{"trash":"f1f8"}</small>
          </p>
          <textarea v-model="mapText" rows="4" placeholder='{"icon-name": "hex", ...}'></textarea>
          <div class="map-actions">
            <button type="button" @click="applyMap">应用映射</button>
            <span v-if="mapStatus" class="map-status">{{ mapStatus }}</span>
          </div>
        </div>

        <p v-if="warning" class="warning">{{ warning }}</p>
        <p v-if="error" class="error">{{ error }}</p>

        <template v-if="parsed.length">
          <!-- 大预览：点击下方卡片才出现（网格让出空间下推）；hero 右上 × 可关闭。
               高度恒定由 .modal.wide 固定高保证（网格弹性吸收 hero 插入/移除，弹窗总高不变） -->
          <div class="hero" v-if="currentItem && currentIdx >= 0">
            <div class="hero-head">
              <span class="hero-name">{{ currentItem.name }}</span>
              <span class="hero-tools">
                <span class="hero-note">按解析设置的 SVG 尺寸（{{ svgWidth(currentItem.svg) }}px）预览</span>
                <button class="hero-close" @click="currentIdx = -1" title="关闭大预览">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                </button>
              </span>
            </div>
            <div class="hero-svg-box" v-html="currentItem.svg"></div>
          </div>
          <div class="preview-head">
            <label><input type="checkbox" :checked="selected.size === parsed.length && parsed.length > 0" @change="toggleAll" /> 全选</label>
            <span>{{ selected.size }} / {{ parsed.length }}</span>
            <!-- 冲突字形检测提示 + 处理操作（存在码位冲突时显示：与内置 ASCII 基础字形或项目已有图标占用同码位） -->
            <span v-if="conflictIndices.size" class="conflict-bar">
              <span class="conflict-info">
                <span class="conflict-dot">
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                    <path d="M8 1.8L15 14H1L8 1.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                    <path d="M8 6.3v3.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                    <circle cx="8" cy="11.7" r="0.8" fill="currentColor" />
                  </svg>
                </span>
                检测到 {{ conflictIndices.size }} 个冲突字符
                <span class="conflict-tip">这些字形与内置基础拉丁字符或项目已有图标占用相同码位。若保留原码位，生成字体时会发生重复码位错误而失败。请选择处理方式：</span>
              </span>
              <label class="mini-radio"><input type="radio" name="conflict-mode" value="auto" v-model="conflictMode" /> 自动分配</label>
              <label class="mini-radio"><input type="radio" name="conflict-mode" value="remove" v-model="conflictMode" /> 移除冲突</label>
              <label class="mini-radio"><input type="radio" name="conflict-mode" value="overwrite" v-model="conflictMode" /> 覆盖旧图标</label>
            </span>
          </div>
          <div class="icon-list">
            <div
              v-for="(item, i) in parsed"
              :key="item.name + i"
              class="icon-item"
              :class="{ on: selected.has(i), conflict: conflictIndices.has(i), disabled: conflictMode === 'remove' && conflictIndices.has(i), current: currentIdx === i }"
              @click="toggleSelect(i)"
            >
              <input type="checkbox" :checked="selected.has(i)" :disabled="conflictMode === 'remove' && conflictIndices.has(i)" @change="toggleSelect(i)" @click.stop />
              <!-- 右上角小眼睛：与左上复选框对称，点击预览该字形（卡片点击则只管勾选） -->
              <button class="preview-eye" type="button" @click.stop="currentIdx = i" :title="'预览：' + item.name">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="M1.6 8C3.2 5 5.9 3.4 8 3.4S12.8 5 14.4 8C12.8 11 10.1 12.6 8 12.6S3.2 11 1.6 8z" fill="none" stroke="currentColor" stroke-width="1.3" />
                  <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.3" />
                </svg>
              </button>
              <div class="mini" v-html="miniSvg(item.svg)"></div>
              <span class="iname" :title="conflictIndices.has(i) ? '码位冲突：与内置基础字符/项目已占用码位相同' : item.name">{{ item.name }}</span>
              <span class="icode" v-if="item.unicode != null" :title="aliasTip(item)">{{ item.unicode.toString(16).toUpperCase().padStart(4, '0') }}</span>
              <!-- #11：预览改名 -->
              <button class="rename-btn" type="button" @click.stop="renameItem(i)" title="改名">改名</button>
            </div>
          </div>
        </template>
      </div>

      <footer>
        <button @click="emit('close')">取消</button>
        <template v-if="parsed.length">
          <button @click="downloadSvgs" :disabled="!exportable.length">下载 SVG (zip)</button>
          <!-- 导入按钮放最右；有冲突时必须先在冲突条旁三选一（自动分配/移除冲突/覆盖旧图标） -->
          <button @click="importToProject" :disabled="!exportable.length || (conflictIndices.size > 0 && !conflictMode)" class="primary" :title="conflictIndices.size && !conflictMode ? '存在冲突字形，请先选择处理方式：自动分配 / 移除冲突 / 覆盖旧图标' : ''">导入项目 ({{ exportable.length }})</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: #fff;
  border-radius: 12px;
  width: min(760px, 92vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  transition: width 0.2s ease; /* 解析完成后加宽的过渡，避免生硬 */
}

/* 解析完成（有字形预览）后整体加宽 + 固定高：
    高度由 max-height 截断时恒为 86vh，网格区弹性吸收 hero 的插入/移除 → 点击大预览/关闭弹窗总高不变 */
.modal.wide {
  width: min(960px, 96vw);
  min-height: 86vh;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

header h3 {
  margin: 0;
  font-size: 16px;
}

.close {
  border: 1px solid transparent; /* 默认无边框（透明边框占位，hover 变实色不位移） */
  background: transparent;
  color: var(--text-2);
  padding: 8px 12px; /* 放大点击区域（图标保持 14px，热区约 40x32） */
  border-radius: 2px; /* hover 出现边框时的圆角 */
  display: inline-flex;
  align-items: center;
  line-height: 1;
  cursor: pointer;
}
.close:hover {
  border-color: var(--border);
  color: var(--text);
}

.body {
  padding: 16px 20px;
  /* 弹窗整体不滚动：内容高度由内部区域各自消化（hero 固定 + 网格占余下空间滚动），
     避免弹窗滚动条与网格滚动条同时出现 */
  overflow: hidden;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 虚线框：上半=解析前设置操作，下半=文件选择区 */
.dropzone {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
  flex: none; /* 弹窗弹性布局下固定区域不参与压缩（否则会被压成一条线） */
}
.dropzone.dragging {
  border-color: var(--primary);
}
/* 上半：解析前操作（尺寸/映射/保持 unicode），紧凑横排，白色底 */
.dz-settings {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: #fff;
}
.dz-settings .size-field {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.dz-settings .size-field > span {
  font-size: 13px;
  color: var(--text-2);
}
.size-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.custom-size {
  width: 90px;
}
.keep-unicode {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-2);
  margin-left: auto; /* 推最右，与前面操作分隔 */
}
.map-btn {
  padding: 6px 12px;
  font-size: 13px;
}
.map-btn.active {
  border-color: var(--primary);
  color: var(--primary);
  background: #f0f6ff;
}

/* 映射表面板（虚线框下方展开）——恢复原版样式 */
.map-box {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 10px;
  background: #fafbfd;
}
.map-desc {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.6;
}
.map-file-link {
  color: var(--primary);
  text-decoration: underline;
  cursor: pointer;
  font-family: Consolas, monospace;
}
.map-file-link:hover {
  color: var(--primary-dark);
}
.map-box textarea {
  width: 100%;
  font-family: Consolas, monospace;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  resize: vertical;
}
/* 应用映射按钮与状态提示同一行横排（不独占一行） */
.map-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.map-status {
  font-size: 12px;
  color: var(--primary);
}
/* 下半：文件选择区（浅灰背景，仅此区域点击触发选择） */
.dz-pick {
  background: #f3f5f9;
  border-top: 1px dashed var(--border);
  padding: 12px 14px;
  text-align: center;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.15s;
}
.dz-pick:hover {
  background: #e9eef5;
}
.dropzone.dragging .dz-pick {
  background: #e3ecfa;
}
.dz-pick p {
  margin: 0;
}
.dz-pick small {
  opacity: 0.7;
}
.dz-reselect {
  margin-top: 6px;
  font-size: 12px;
  color: var(--primary);
  text-decoration: underline;
}
.warning {
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 8px 10px;
  margin: 10px 0 0;
  font-size: 12px;
}

.error {
  color: var(--danger);
  margin: 10px 0 0;
}

/* 大预览：固定高度（空态占位与显示字形高度一致），点击卡片只在内部换内容，弹窗总高不跳变 */
.hero {
  margin: 14px 0 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  background: #fff;
  /* 弹性高度：基准 320px，视口/剩余空间不足时优先压缩 hero（下限 180px）——
     保证网格区保底可见可滚，弹窗固定高内不产生溢出滚动 */
  flex: 0 1 320px;
  min-height: 180px;
  display: flex;
  flex-direction: column;
}

.hero-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}

.hero-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-note {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
}

.hero-tools {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* 大预览关闭：与 header 关闭同一套视觉（默认无边框、hover 边框 2px 圆角） */
.hero-close {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
  padding: 3px 8px; /* hero 内关闭按钮热区保持小尺寸即可（header 关闭才要求大热区） */
  border-radius: 2px;
  display: inline-flex;
  align-items: center;
  line-height: 1;
  cursor: pointer;
}
.hero-close:hover {
  border-color: var(--border);
  color: var(--text);
}

.hero-head {
  flex: none; /* 头部占位固定，不随内容高度伸缩 */
}

.hero-svg-box {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.hero-svg-box :deep(svg) {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  color: #333;
}



.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 14px 0 8px;
  font-size: 13px;
  color: var(--text-2);
  flex: none; /* 同上：固定区域不参与弹性压缩 */
}

.preview-head label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.icon-list {
  display: grid;
  /* 固定列宽：卡片大小恒定，少量字形时不被 1fr 拉伸撑满（图标类目视觉一致） */
  grid-template-columns: repeat(auto-fill, 104px);
  /* 行高按内容自适应且行不从顶部拉伸（否则单行时被撑满容器高度，卡片留大片空白） */
  grid-auto-rows: min-content;
  align-content: start;
  gap: 8px;
  /* 弹性占满 body 剩余高度（min-height:96px 保底，hero 出现时网格仍可见可滚），滚动条只出现在这里 */
  flex: 1;
  min-height: 96px;
  overflow-y: auto;
  padding-right: 4px;
}

.icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 紧凑排布：文字/按钮占位尽量小，把空间让给字形预览 */
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 4px 4px;
  cursor: pointer;
  position: relative;
}


/* current = 大预览正在显示的字形：加粗外描边（强于勾选边框），与勾选(on)区分 */
.icon-item.current {
  box-shadow: 0 0 0 3px var(--primary);
}

/* 右上角小眼睛：与左上复选框对称，浅灰装饰默认态，hover 主色 */
.preview-eye {
  position: absolute;
  top: 4px;
  right: 4px;
  border: none;
  background: transparent;
  color: var(--text-2); /* 浅灰：与同层级 logo/次要信息一致 */
  padding: 3px 5px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  line-height: 1;
  cursor: pointer;
}

.preview-eye:hover {
  color: var(--primary);
  background: #eef4ff;
}

/* 冲突字形（与内置基础字符或项目已占用码位相同）：标红提示 */
.icon-item.conflict {
  border-color: #e11d48;
  background: #fff1f2;
}
.icon-item.conflict.on {
  border-color: #e11d48;
  background: #ffe4e6;
}
/* 预览头部冲突提示条 */
.conflict-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.conflict-info {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #b91c1c;
  position: relative;
  cursor: default;
}
.conflict-dot {
  width: 16px; height: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: #fecaca;
  color: #b91c1c;
  font-weight: 700;
}
/* 悬浮解释：hover 显示完整说明 */
.conflict-tip {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 340px;
  background: #fff;
  border: 1px solid #fecaca;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  color: #4b5563;
  z-index: 20;
  white-space: normal;
  font-weight: 400;
}
.conflict-info:hover .conflict-tip { display: block; }
/* 冲突处理小按钮 */
.mini-btn {
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  cursor: pointer;
  transition: all .15s;
}
.mini-btn:hover { border-color: var(--primary); color: var(--primary); }
.mini-btn.danger { color: #b91c1c; border-color: #fecaca; background: #fff; }
.mini-btn.danger:hover { background: #fff1f2; border-color: #e11d48; }

.icon-item.on {
  border-color: var(--primary);
  background: #f0f6ff;
}

.icon-item input {
  position: absolute;
  top: 6px;
  left: 6px;
}

.mini {
  color: #333;
  height: 48px; /* 图标区加大，为字体图标留更多空间 */
  display: flex;
  align-items: center;
}

.iname {
  font-size: 12px;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 码位：与名称同级的次要信息，最小字号 12px */
.icode {
  font-size: 12px;
  line-height: 1.2;
  color: var(--text-2);
  font-family: Consolas, Monaco, monospace;
}

/* 卡片内「改名」按钮：紧凑（全局按钮默认内边距偏大） */
.rename-btn {
  padding: 1px 8px;
  font-size: 12px;
  border-radius: 4px;
  line-height: 1.5;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}

/* 冲突处理单选（radio） */
.mini-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  padding: 2px 4px;
}
.mini-radio input {
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
/* remove 模式：冲突卡片禁用（不可点、视觉置灰） */
.icon-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.icon-item.disabled .mini,
.icon-item.disabled .iname,
.icon-item.disabled .icode {
  pointer-events: none;
}
.icon-item.disabled input {
  cursor: not-allowed;
}
</style>