# ScraperTool — 网页自动化抓取工具

> 支持可视化录制、19 种操作步骤、实时流式执行、循环采集、代理和有头浏览器模式。

---

## 目录

1. [环境要求](#环境要求)
2. [快速开始](#快速开始)
3. [环境变量配置](#环境变量配置)
4. [Chromium 路径配置](#chromium-路径配置)
5. [启动服务](#启动服务)
6. [代理配置](#代理配置)
7. [有头模式（本地代理用户看这里）](#有头模式本地代理用户看这里)
8. [功能概览](#功能概览)
9. [部署到服务器](#部署到服务器)

---

## 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | ≥ 18.0 | 推荐 20 LTS |
| pnpm | ≥ 9.0 | 必须用 pnpm，不能用 npm/yarn |
| Chromium / Chrome | 任意新版 | 用于浏览器自动化 |

**安装 Node.js（推荐用 nvm）：**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

**安装 pnpm：**

```bash
npm install -g pnpm
```

**安装 Chromium（Ubuntu/Debian）：**

```bash
sudo apt update
sudo apt install -y chromium-browser
# 或者：
sudo apt install -y chromium
```

**安装 Chromium（CentOS/RHEL）：**

```bash
sudo yum install -y chromium
```

---

## 快速开始

```bash
# 1. 解压源码包
tar xzf scraper-tool.tar.gz
cd scraper-tool   # 或解压出来的文件夹名

# 2. 安装依赖（首次安装约需 2~5 分钟）
pnpm install

# 3. 配置环境变量（参考下一节）
cp .env.example .env   # 如果有的话，否则手动创建
# 最简单的配置：设置 SESSION_SECRET 即可

# 4. 启动
pnpm run dev
```

浏览器打开 `http://localhost:25879`（前端）即可使用。

---

## 环境变量配置

在项目根目录创建 `.env` 文件（如果不存在）：

```bash
# 必填：Session 加密密钥，随机字符串即可，越长越好
SESSION_SECRET=你的随机密钥_至少32位字符

# 可选：Chromium 可执行文件路径（见下一节）
# CHROMIUM_PATH=/usr/bin/chromium-browser
```

**生成随机密钥的方法：**

```bash
# Linux / macOS
openssl rand -base64 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Chromium 路径配置

程序默认会在固定 Nix 路径查找 Chromium。**本地部署时必须配置此项。**

先找到你的 Chromium 路径：

```bash
which chromium-browser
which chromium
which google-chrome
# 一般是 /usr/bin/chromium-browser 或 /usr/bin/chromium
```

然后在 `.env` 中设置：

```bash
CHROMIUM_PATH=/usr/bin/chromium-browser
```

或者直接在 `artifacts/api-server/src/lib/stealth-browser.ts` 第 3 行修改默认值：

```typescript
export const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/usr/bin/chromium-browser";  // ← 改成你的路径
```

---

## 启动服务

项目由两个服务组成，需要**分两个终端**分别启动：

**终端 1 — 后端 API 服务器（端口 8080）：**

```bash
pnpm --filter @workspace/api-server run dev
```

**终端 2 — 前端界面（端口 25879）：**

```bash
pnpm --filter @workspace/scraper-tool run dev
```

然后浏览器打开 `http://localhost:25879` 即可。

> 如果你是部署到服务器且需要对外访问，需要在防火墙开放 **25879** 端口（前端），后端 8080 端口可以只对内开放。

---

## 代理配置

在工具界面的「目标网址」卡片中，有一个「代理设置」输入框，支持以下格式：

```
# HTTP 代理（带账号密码）
http://username:password@proxy.host.com:port

# SOCKS5 代理（无密码）
socks5://proxy.host.com:port

# SOCKS5 代理（带账号密码）
socks5://username:password@proxy.host.com:port
```

**如果你在本地跑此工具，并且本地有 V2Ray / Xray / Clash 客户端，可以直接填：**

```
socks5://127.0.0.1:10808
```

（端口号根据你的客户端配置填写，V2Ray 默认是 10808，Clash 默认是 7891）

代理设置会自动保存到浏览器本地，下次打开还在。

---

## 有头模式（本地代理用户看这里）

「有头模式」让 Chromium 以真实窗口模式运行（通过 Xvfb 虚拟显示器），可以绕过部分依赖屏幕检测的反爬机制。

**服务器端使用有头模式，需要安装 Xvfb：**

```bash
# Ubuntu / Debian
sudo apt install -y xvfb

# CentOS / RHEL
sudo yum install -y xorg-x11-server-Xvfb
```

安装后在界面的「有头模式」开关打开即可，程序会自动启动 Xvfb。

**如果在本地 macOS / Windows 桌面电脑上运行，有头模式会直接弹出真实 Chromium 窗口**（不需要 Xvfb）。此时可以修改 `stealth-browser.ts` 去掉 Xvfb 相关逻辑，直接：

```typescript
return chromium.launch({ headless: false, executablePath: CHROMIUM_PATH, args: LAUNCH_ARGS });
```

---

## 功能概览

### 19 种操作步骤

| 步骤类型 | 说明 |
|---------|------|
| click | 点击元素 |
| doubleclick | 双击元素 |
| rightclick | 右键点击 |
| hover | 鼠标悬停 |
| type | 输入文本（支持变量插值） |
| key | 按键（如 Enter、Tab） |
| select | 下拉选择 |
| scroll | 滚动到元素 |
| navigate | 跳转到指定 URL |
| goback | 浏览器后退 |
| goforward | 浏览器前进 |
| reload | 刷新页面 |
| wait | 等待（毫秒） |
| screenshot | 截图 |
| capture | 读取元素内容（可存入变量） |
| listen | 监听网络请求（可存入变量） |
| newtab | 新建标签页 |
| switchtab | 切换标签页 |
| closetab | 关闭标签页 |

### 变量系统

- 用 `capture` 步骤将页面内容存入变量：变量名填 `price`
- 后续步骤用 `${price}` 引用变量
- 用 `listen` 步骤监听 API 响应并提取 JSON 字段
- 执行时会实时显示变量当前值

### 可视化录制器

点击「可视化录制步骤」：
1. 在右侧看到实时浏览器截图
2. 直接点击截图中的元素来生成步骤
3. 录制完成后一键导入到步骤序列

### 方案保存与导出

- 点击「保存方案」给当前步骤序列起名保存
- 「导出」将所有方案导出为 JSON 文件
- 「导入」从 JSON 文件恢复（同名方案会覆盖）

### 循环采集

在执行区域开启「循环模式」，可以设置循环间隔，自动反复执行。适合定时监控价格、库存等场景。

---

## 部署到服务器

### 使用 PM2 保持后台运行

```bash
# 安装 PM2
npm install -g pm2

# 先构建
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/scraper-tool run build

# 用 PM2 启动后端
pm2 start "node artifacts/api-server/dist/index.mjs" --name scraper-api

# 前端是静态文件，用 nginx 或 serve 托管 artifacts/scraper-tool/dist/
npm install -g serve
pm2 start "serve -s artifacts/scraper-tool/dist -l 25879" --name scraper-ui

# 保存 PM2 配置（重启后自动恢复）
pm2 save
pm2 startup
```

### Nginx 反向代理（可选，统一端口访问）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/scraper-tool/artifacts/scraper-tool/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        # SSE 流式传输需要关闭缓冲
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

### 环境变量设置

```bash
# 在服务器上设置环境变量
export SESSION_SECRET="你的随机密钥"
export CHROMIUM_PATH="/usr/bin/chromium-browser"

# 或者写到 ~/.bashrc / ~/.profile
echo 'export SESSION_SECRET="你的随机密钥"' >> ~/.bashrc
echo 'export CHROMIUM_PATH="/usr/bin/chromium-browser"' >> ~/.bashrc
source ~/.bashrc
```

---

## 常见问题

**Q: 启动时报 `CHROMIUM_PATH` 相关错误**

A: 找到你的 Chromium 路径（`which chromium-browser`），在 `.env` 文件中设置 `CHROMIUM_PATH=你的路径`。

**Q: 执行时页面一直转圈或报超时**

A: 目标网站可能有防护，尝试：①开启有头模式 ②配置住宅代理 ③在步骤前加一个「等待」步骤。

**Q: SSE 流断开 / 执行到一半没反应**

A: Nginx 默认读取超时较短，需要在 nginx 配置中加 `proxy_read_timeout 300s;` 并关闭 `proxy_buffering off;`。

**Q: pnpm install 很慢**

A: 可以配置 pnpm 镜像源：
```bash
pnpm config set registry https://registry.npmmirror.com
```

**Q: 本地开发时前端请求 /api 报 404**

A: 确保后端服务（端口 8080）已经启动，前端的 Vite 配置会自动把 `/api` 代理到 8080。

---

*ScraperTool — 自动化不止于此*
