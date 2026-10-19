# 药品信息查询 App

一个专为医药代表设计的**纯信息展示型**药品查询移动网页应用。

## 特点

- 🚪 **无需登录** — 打开即用，无个人账户
- 💊 **结构化药品信息** — 说明书、药理临床、安全性、竞争格局、准入信息、学术资料、FAQ
- 🔍 **全局搜索** — 快速查找药品和关键信息
- 📱 **移动优先** — 专为手机端优化设计
- 🌐 **PWA支持** — 可添加到主屏幕，支持离线访问
- ⚡ **纯静态站点** — 零后端，部署简单

## 技术架构

- **Vue 3** (CDN) — 响应式UI框架
- **Fuse.js** — 客户端模糊搜索
- **纯静态** — 无需构建工具，直接部署
- **Service Worker** — PWA离线支持

## 项目结构

```
drug-app/
├── index.html          # 主页面
├── manifest.json       # PWA配置
├── sw.js               # Service Worker
├── css/
│   └── style.css       # 样式文件
├── js/
│   └── app.js          # Vue应用逻辑
├── data/
│   └── drugs.json      # 药品数据库
└── icons/
    ├── icon-192.png    # PWA图标 (192x192)
    └── icon-512.png    # PWA图标 (512x512)
```

## 部署到 GitHub Pages

### 方式一：gh-pages 分支

```bash
# 将 drug-app 目录内容推送到 gh-pages 分支
git subtree push --prefix drug-app origin gh-pages
```

### 方式二：GitHub Actions

在仓库中创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./drug-app
```

### 方式三：手动部署

1. 将 `drug-app/` 目录内容复制到仓库根目录
2. 在仓库 Settings > Pages 中，选择 `main` 分支的 `/ (root)` 目录

## 数据维护

编辑 `data/drugs.json` 文件即可更新药品数据，支持添加、修改、删除药品条目。数据格式：

```json
{
  "id": "唯一标识",
  "name": "药品商品名",
  "genericName": "通用名",
  "category": "分类",
  "sections": {
    "prescribing_info": { "title": "说明书", "content": { ... } },
    "clinical_data": { "title": "药理临床数据", "content": { ... } },
    ...
  }
}
```

## 自定义

- **分类图标**：在 `js/app.js` 的 `getCategoryIcon()` 函数中修改
- **主题颜色**：在 `css/style.css` 的 `:root` 变量中修改
- **搜索范围**：在 `js/app.js` 的 `fuseInstance` 初始化中调整搜索权重

## 数据来源声明

本应用数据仅供医药代表参考使用，具体用药请以最新版药品说明书为准。
