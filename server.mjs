import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'

// 极简本地静态文件服务（离线运行所需）
// 用法：node server.mjs [端口] [根目录]
const PORT = Number(process.argv[2]) || 2333
// ROOT 默认取 server.mjs 同级的 dist 目录。
// 为什么必须 decodeURIComponent：file URL 的 pathname 会把中文/空格等字符编码成 %XX
// （如 %E4%B8%AD、%20），而 existsSync/readFileSync 不做解码——项目装在含中文或空格
// 的路径下时，所有请求都会命中 404 "Not Found"（2026-09 实测复现，纯英文路径无此问题）
const ROOT = process.argv[3] || decodeURIComponent(new URL('./dist', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
}

const server = http.createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (path === '/') path = '/index.html'
  const file = normalize(join(ROOT, path))
  // 防路径穿越
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); res.end('Forbidden'); return }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('Not Found'); return }
  const ext = extname(file).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  res.end(readFileSync(file))
})

server.listen(PORT, () => {
  console.log('服务已启动: http://localhost:' + PORT)
})
