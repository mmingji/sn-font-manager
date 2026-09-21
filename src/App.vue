<script setup>
import { ref, computed, onMounted } from 'vue'
import { useProjectStore } from './store/project'
import IconGrid from './components/IconGrid.vue'
import FontParser from './components/FontParser.vue'
import ImportModal from './components/ImportModal.vue'
import ImageToSvgModal from './components/ImageToSvgModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import DropdownMenu from './components/DropdownMenu.vue'
import { exportSvgZip, exportProjectZip } from './lib/zip'
import { flushPendingSnapshot } from './lib/persist'
import { buildWordmarkSvg } from './lib/logo'
import { isBitmapFile } from './lib/traceImage'

const store = useProjectStore()

// 导入/导出下拉互斥：同时只开一个
const importOpen = ref(false)
const exportOpen = ref(false)
function setImportOpen(v) { importOpen.value = v; if (v) exportOpen.value = false }
function setExportOpen(v) { exportOpen.value = v; if (v) importOpen.value = false }

// 异常 SVG 自检与修复（启动时 + 每次导入后都执行）
// 职责：检测项目内坐标越界/格式异常的 SVG 并就地修复（幂等），结果用顶部提示条反馈
const repairNotice = ref('')
const repairing = ref(false)

async function checkAndRepair() {
  // 轻量探测：无异常则完全静默（正常刷新/导入不该闪「检查中」）
  const hasAbnormal = store.probeAbnormal()
  if (!hasAbnormal) return 0
  repairing.value = true
  const n = await store.repairAll((done, total, fixed) => {
    repairNotice.value = `正在修复异常图标坐标… ${done}/${total}` + (fixed ? `（已修复 ${fixed}）` : '')
  })
  repairing.value = false
  repairNotice.value = `已自动修复 ${n} 个异常图标（坐标越界）`
  setTimeout(() => (repairNotice.value = ''), 5000)
  return n
}

onMounted(async () => {
  // 刷新/关闭前：IDB 异步写入可能未完成，同步把最新快照落 localStorage 兜底（防丢写）
  const flush = () => flushPendingSnapshot()
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  // 启动引导：先完成 IDB 数据恢复（booted gate 挡住首帧，避免「空白→闪现完整列表」）
  await store.bootstrap()
  await checkAndRepair()
})

// 弹窗控制
const showParser = ref(false)
const showImport = ref(false)
const showImageToSvg = ref(false)
const showSettings = ref(false)

// 图片转 SVG 弹窗的替换目标：非空 = 替换模式（从图标卡片「替换」进入），空 = 常规导入
const replaceTarget = ref(null)
// 空状态快捷上传的初始文件：按类型分流后交给对应弹窗自动处理
const importInitialFiles = ref(null)   // svg → 导入 SVG 弹窗
const imageInitialFiles = ref(null)    // 图片 → 图片转 SVG 弹窗
const parserInitialFile = ref(null)    // 字体 → 解析字体弹窗

function openImageToSvg(files = null) {
  replaceTarget.value = null
  imageInitialFiles.value = files
  showImageToSvg.value = true
}

function openReplaceImageToSvg(icon) {
  replaceTarget.value = { id: icon.id, name: icon.name }
  imageInitialFiles.value = null
  showImageToSvg.value = true
}

function closeImageToSvg() {
  showImageToSvg.value = false
  replaceTarget.value = null
  imageInitialFiles.value = null
}

// ---------- 空状态：点击/拖拽上传，按类型自动分流 ----------
const emptyDragging = ref(false)
const emptyFileInput = ref(null)

function isFontFileX(f) {
  return /\.(ttf|otf|woff2|woff)$/i.test(f.name || '') || /font\//.test(f.type || '')
}

function onEmptyDrop(e) {
  emptyDragging.value = false
  onEmptyFiles([...(e.dataTransfer?.files || [])])
}

function onEmptyFiles(files) {
  if (!files.length) return
  const fonts = files.filter(isFontFileX)
  const svgs = files.filter((f) => /\.svg$/i.test(f.name || '') || f.type === 'image/svg+xml')
  const images = files.filter(isBitmapFile)
  const groups = [fonts, svgs, images].filter((g) => g.length)
  if (groups.length > 1) {
    alert('请按类型分批上传（SVG / 字体 / 图片混合拖入暂不支持）')
    return
  }
  if (fonts.length) {
    parserInitialFile.value = fonts[0] // 字体解析一次处理一个文件
    showParser.value = true
  } else if (svgs.length) {
    importInitialFiles.value = svgs
    showImport.value = true
  } else if (images.length) {
    openImageToSvg(images)
  } else {
    alert('未识别的文件类型：支持 SVG / ttf / otf / woff / woff2 / 图片')
  }
}

// 空状态 Logo：用内置 regular 字形生成的 SnFont 字样（浅灰装饰，见 lib/logo.js）
const wordmark = buildWordmarkSvg('SnFont')

// 搜索（#1：默认隐藏，按钮展开）
const keyword = ref('')
const showSearch = ref(false)
const searchInput = ref(null)

function toggleSearch() {
  showSearch.value = !showSearch.value
  if (showSearch.value) {
    // 展开后聚焦输入框
    setTimeout(() => searchInput.value?.focus(), 50)
  } else {
    keyword.value = ''
  }
}

function closeSearch() {
  showSearch.value = false
  keyword.value = ''
}

// 批量选择
const selectMode = ref(false)
const selectedIds = ref([])

const filteredIcons = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return store.icons
  return store.icons.filter((i) => {
    if (i.name.toLowerCase().includes(kw)) return true
    // 支持按 unicode 搜索：不补齐（41）与 4 位补齐（0041）两种格式都认，
    // 带不带 u+ 前缀均可——与 demo 页按卡片显示格式（0041）搜索的口径对齐
    if (i.code != null) {
      const hex = i.code.toString(16).toLowerCase()
      const padded = hex.padStart(4, '0')
      if (hex.includes(kw) || padded.includes(kw) || ('u+' + hex).includes(kw) || ('u+' + padded).includes(kw)) return true
    }
    return false
  })
})

function toggleAll() {
  if (selectedIds.value.length === filteredIcons.value.length) {
    selectedIds.value = []
  } else {
    selectedIds.value = filteredIcons.value.map((i) => i.id)
  }
}

function removeSelected() {
  if (!selectedIds.value.length) return
  if (confirm(`确认删除选中的 ${selectedIds.value.length} 个图标？`)) {
    store.removeIcons(selectedIds.value)
    selectedIds.value = []
  }
}

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = []
}

// 导出
// #9：导出 SVG 需先选择图标
async function exportSvgs() {
  if (!selectMode.value) {
    // 未选择：进入多选模式提示先选择
    selectMode.value = true
    alert('请先勾选要导出的图标，再点「导出 SVG」')
    return
  }
  const selectedIcons = store.icons.filter((i) => selectedIds.value.includes(i.id))
  if (!selectedIcons.length) {
    alert('请先勾选要导出的图标')
    return
  }
  await exportSvgZip(selectedIcons, store.svgSize, `${store.fontName}-svgs.zip`)
}

// 多选模式下导出选中项（工具栏按钮用）
async function exportSelectedSvgs() {
  const selectedIcons = store.icons.filter((i) => selectedIds.value.includes(i.id))
  if (!selectedIcons.length) {
    alert('请先勾选要导出的图标')
    return
  }
  await exportSvgZip(selectedIcons, store.svgSize, `${store.fontName}-svgs.zip`)
}

async function exportProject() {
  await exportProjectZip(
    {
      name: store.name,
      fontName: store.fontName,
      classPrefix: store.classPrefix,
      weight: store.weight,
      icons: store.icons,
      svgSize: store.svgSize
    },
    store.svgSize
  )
}

</script>

<template>
  <!-- 启动引导占位：等待 store.bootstrap() 从 IndexedDB 恢复项目数据后渲染完整界面，避免空白闪现 -->
  <div v-if="!store.booted" class="boot-loading"><div class="spinner"></div><p>加载中…</p></div>
  <div class="app" v-if="store.booted">
    <header class="topbar">
      <div class="brand">
        <div class="brand-text">
          <!-- 顶栏品牌固定为「SnFont 字体图标管理」（应用名，与用户项目名无关）；项目名在副信息行展示 -->
          <h1>SnFont 字体图标管理</h1>
          <div class="project-sub">
            <span>{{ store.name }}</span>
            <span class="sub-sep">·</span>
            <span>前缀 {{ store.classPrefix }}</span>
            <span class="sub-sep">·</span>
            <span>{{ store.weight === 'bold' ? '粗体 Bold' : '常规 Regular' }}</span>
            <span class="sub-sep">·</span>
            <span>共 {{ store.count }} 个图标</span>
          </div>
        </div>
      </div>
      <div class="actions">
        <button @click="toggleSearch" :class="{ active: showSearch }" title="搜索图标">搜索</button>
        <button @click="toggleSelectMode">{{ selectMode ? '退出多选' : '多选' }}</button>
        <button @click="showSettings = true" title="项目名称/CSS前缀/字体名/SVG尺寸">设置</button>
        <DropdownMenu label="导入" title="导入 SVG / 图片转 SVG / 解析字体" :open="importOpen" @update:open="setImportOpen">
          <button @click="showImport = true">导入 SVG</button>
          <button @click="openImageToSvg">图片转 SVG</button>
          <button @click="showParser = true">解析字体</button>
        </DropdownMenu>
        <!-- 导出下拉：整个按钮为主色主操作(导出)，下载项目为普通菜单项 -->
        <DropdownMenu label="导出" title="下载项目 / 导出 SVG" class="export-dd primary menu-right" :open="exportOpen" @update:open="setExportOpen">
          <button @click="exportProject">下载项目</button>
          <button @click="exportSvgs">导出 SVG</button>
        </DropdownMenu>
      </div>
    </header>
    <!-- 启动自动修复提示：进度/结果独立展示，不随 toolbar 折叠而隐藏 -->
    <div class="repair-toast" v-if="repairNotice" :class="{ done: !repairing }">
      <span class="repair-icon">
        <svg v-if="repairing" class="spin" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 1.8a6.2 6.2 0 1 1-4.4 1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <svg v-else viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2.5 8.6l3.4 3.4 7.6-8.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      {{ repairNotice }}
    </div>

    <!-- toolbar：未点搜索时仅显示一条灰色线；点搜索后显示搜索框 + 匹配统计；多选操作保留 -->
    <section class="toolbar" :class="{ searching: showSearch || selectMode }">
      <template v-if="showSearch">
        <div class="search-box">
          <input v-model="keyword" type="text" placeholder="搜索名称或 unicode…" ref="searchInput" @keydown.esc="closeSearch" />
        </div>
        <!-- 搜索统计始终显示；repairNotice 为独立的启动修复提示，不与统计互斥 -->
        <div class="stat">共 {{ filteredIcons.length }} / {{ store.count }} 个图标</div>
      </template>
      <div class="toolbar-right" v-if="selectMode">
        <label class="select-all">
          <input type="checkbox" :checked="selectedIds.length === filteredIcons.length && filteredIcons.length > 0" @change="toggleAll" />
          全选
        </label>
        <button :disabled="!selectedIds.length" @click="exportSelectedSvgs">导出选中 SVG</button>
        <button class="danger" :disabled="!selectedIds.length" @click="removeSelected">删除选中 ({{ selectedIds.length }})</button>
      </div>
    </section>

    <main class="content" :class="{ empty: !store.count }">
      <!-- 项目有图标时渲染网格；无图标时只显示引导提示(避免空网格+引导叠加) -->
      <IconGrid
        v-if="store.count"
        :icons="filteredIcons"
        :select-mode="selectMode"
        :selected-ids="selectedIds"
        @toggle-select="(id) => {
          const idx = selectedIds.indexOf(id)
          idx >= 0 ? selectedIds.splice(idx, 1) : selectedIds.push(id)
        }"
        @replace="openReplaceImageToSvg"
      />
      <!-- 首次打开/无图标时的引导：大 Logo + 拖拽/点击上传（SVG/字体/图片自动分流）+ 快捷键入口 -->
      <div v-if="!store.count" class="empty">
        <input ref="emptyFileInput" type="file" multiple hidden
          accept=".svg,.ttf,.otf,.woff,.woff2,image/png,image/jpeg,image/webp,image/gif,image/bmp"
          @change="(e) => { onEmptyFiles([...(e.target.files || [])]); e.target.value = '' }" />
        <div class="empty-drop" :class="{ dragging: emptyDragging }"
          @dragover.prevent="emptyDragging = true"
          @dragleave="emptyDragging = false"
          @drop.prevent="onEmptyDrop"
          @click="emptyFileInput.click()">
          <div class="logo" v-html="wordmark" aria-hidden="true"></div>
          <p class="empty-hint">项目还没有图标，请先导入 SVG，或上传字体文件解析</p>
          <p class="empty-sub">点击或拖入文件到此处：SVG 图标 / 字体文件 / 图片均可，将自动进入对应流程</p>
        </div>
        <div class="empty-actions">
          <button @click="showImport = true">导入 SVG</button>
          <button @click="showParser = true">解析字体文件</button>
          <button @click="openImageToSvg()">图片转 SVG</button>
        </div>
      </div>
    </main>

    <FontParser
      v-if="showParser"
      :initial-file="parserInitialFile"
      @close="showParser = false; parserInitialFile = null"
      @imported="checkAndRepair"
    />
    <ImportModal v-if="showImport" :initial-files="importInitialFiles" @close="showImport = false; importInitialFiles = null" />
    <ImageToSvgModal v-if="showImageToSvg" :replace-target="replaceTarget" :initial-files="imageInitialFiles" @close="closeImageToSvg" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.app {
  /* 去掉 max-width，页面自适应撑满 */
  margin: 0 auto;
  padding: 0 20px;
  /* #4：占满视口高度，flex 布局，main 内部滚动 */
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 0;
  gap: 12px;
  flex-wrap: wrap;
}

/* 顶栏左侧仅文字块 */
.brand {
  min-width: 0;
}

.brand-text h1 {
  margin: 0;
  font-size: 20px;
}

.project-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub-sep {
  color: #c9cfdb;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar {
  /* 默认：只有一条灰色线（不占高度，仅下边框） */
  display: flex;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  padding: 0;
  margin-bottom: 16px;
  flex-wrap: wrap;
  height: 0;
  overflow: visible;
}

/* 搜索/多选时：正常内容布局，恢复高度 */
.toolbar.searching {
  height: auto;
  padding: 8px 0;
  min-height: 37px;
  gap: 12px;
}

.search-box {
  flex: 1;
  min-width: 200px;
}

.search-box input {
  width: 100%;
}

.stat {
  /* 无填充，只保留底部一条线（与 head 风格一致） */
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  padding: 2px 2px 2px 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}

.content {
  position: relative;
  /* #4：占满剩余高度 */
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* #6：空状态给 main 区域加边框 */
.content.empty {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  background: #fafbfd;
  min-height: 300px;
}

.empty {
  text-align: center;
  padding: 48px 0 64px;
  color: var(--text-2);
}

/* 空状态上传区：整块可点击/拖拽，按文件类型自动分流 */
.empty-drop {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  background: #fafbfd;
  padding: 44px 20px 30px;
  cursor: pointer;
  transition: all 0.15s;
  max-width: 560px;
  margin: 0 auto;
}

.empty-drop.dragging {
  border-color: var(--primary);
  background: #f0f6ff;
}

/* SnFont 字形 Logo：用内置 regular 字形生成的 svg（浅灰，见 lib/logo.js） */
.logo {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.logo svg {
  width: 220px;
  height: auto;
}

.empty-hint {
  font-size: 15px;
  color: var(--text);
  margin: 0 0 8px;
}

.empty-sub {
  font-size: 12px;
  color: var(--text-2);
  margin: 0;
}

.empty-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 18px;
}

/* 启动引导加载占位：居中显示 spinner + 文案 */
.boot-loading {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--text-2);
}
.boot-loading p {
  margin: 0;
  font-size: 13px;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: boot-spin 0.8s linear infinite;
}
@keyframes boot-spin {
  to { transform: rotate(360deg); }
}

/* 启动自动修复提示条：悬浮于内容区上方，进度(⟳)/完成(✓)两种状态 */
.repair-toast {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1f2937;
  color: #fff;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(0,0,0,.18);
  animation: toast-in .2s ease-out;
}
.repair-toast.done {
  background: #16a34a;
}
.repair-icon {
  line-height: 1;
  display: inline-flex;
}

/* 修复进度旋转图标（复用 boot-spin 动画） */
.repair-icon .spin {
  animation: boot-spin 0.8s linear infinite;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
</style>
