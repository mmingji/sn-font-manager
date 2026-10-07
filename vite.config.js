import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import fs from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// 构建形态：绿色免安装版（dist/index.html 双击即用，file:// 协议）
// 关键约束与对策（详见 README「离线运行」）：
// 1) file:// 下 <script type="module"> 会被 CORS 拦截 → 产物用 IIFE（经典脚本，无 CORS）
// 2) file:// 下 fetch 外部文件（wasm/json）被拦 → 以 dataURL 内联（assetsInlineLimit 放开）
// 3) 不使用 Service Worker/PWA（file:// 下本就不可用），维持零依赖双击运行
// 绿色版 index.html 定制（仅构建时）：
// 1) favicon 内联为 data URI（源：public/favicon.svg；dev 下仍走外部文件）
// 2) 构建后清理 dist 里的 favicon.svg 副本 —— public/ 会被整体复制到 dist，
//    而 favicon 已内联，留下副本会让"单文件产物"不干净（2026-10 处理）
// 3) 可编辑数据脚本（unicode-map.data.js 等）不静态注入：
//    静态 <script src> 会被缓存，导致"改文件后普通刷新读旧数据"；
//    改由应用运行时动态加载（lib/loadDataScript.js，带时间戳绕缓存），保证刷新即生效
function portableIndexPlugin() {
  return {
    name: 'snfont-portable-index',
    apply: 'build',
    transformIndexHtml(html) {
      const faviconPath = fileURLToPath(new URL('./public/favicon.svg', import.meta.url))
      if (!fs.existsSync(faviconPath)) return html
      const svg = fs.readFileSync(faviconPath, 'utf8')
      const dataUri = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim())
      return html.replace(/<link rel="icon"[^>]*>/, '<link rel="icon" href="' + dataUri + '" />')
    },
    closeBundle() {
      const copied = fileURLToPath(new URL('./dist/favicon.svg', import.meta.url))
      if (fs.existsSync(copied)) {
        fs.rmSync(copied)
        console.log('[portable] 已移除 dist/favicon.svg（favicon 已内联进 index.html）')
      }
    }
  }
}

export default defineConfig({
  // viteSingleFile：把 JS/CSS 全量内联进 index.html（file:// 下 <script type="module" src>
  // 与 <link crossorigin> 都会被 CORS 拦截；内联后无外部引用，双击 index.html 即用）
  plugins: [vue(), viteSingleFile(), portableIndexPlugin()],
  base: './',
  resolve: {
    alias: {
      // fontkit 用 node 版构建（浏览器构建对 CFF 紧凑曲线有 bug，见 lib/parseFont.js 头部注释）
      // 其 brotli 引用指到 stub（woff2 解码走 fonteditor wasm，不触发该路径）
      'fontkit': fileURLToPath(new URL('./node_modules/fontkit/dist/module.mjs', import.meta.url)),
      'brotli/decompress.js': fileURLToPath(new URL('./src/lib/brotli-stub.js', import.meta.url))
    }
  },
  build: {
    // 单文件 IIFE：经典脚本（可 file:// 直开），所有依赖内联
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 4 * 1024 * 1024, // wasm/JSON/svg 全部内联为 dataURL（4MB 上限覆盖 woff2.wasm 710KB）
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        // 固定文件名（便于双击分发与排查；hash 对本地绿色版无缓存收益）
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
        chunkFileNames: 'assets/[name].js'
      }
    }
  }
})
