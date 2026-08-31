# 📚 微信读书 · 热门划线摘录

一个本地小工具：输入书的 bookId，自动从微信读书抓取**热门划线**（含划线原文、划线人数、所属章节），
在左侧书单 + 右侧列表里浏览、收藏式删选，一键导出。

**完全不需要登录** —— 匿名访问微信读书公开接口即可。

## ✨ 功能

- 🔍 **填 bookId 自动抓取**：输入书籍详情页 URL 里 `bookDetail/` 后面那串（`b` 开头或纯数字均可）
- 📖 **书名/作者自动补全**：自动从微信读书详情页提取真实书名、作者
- 🗑 **划线级删选**：每条划线可单独删除（本地删选，不影响微信读书）
- 🗑 **书籍级管理**：每本书可删除
- 💾 **本地持久化**：数据存浏览器 localStorage，刷新不丢
- 📤 **导出/导入（标准 JSON）**：
  - **导出当前书 (JSON)**：导出单本书的结构化划线数据
  - **导出全部 (JSON)**：一次性备份所有书籍到单个 JSON 文件
  - **导入 JSON**：随时导入单本或多本备份，无损还原

> ⚠️ 说明：微信读书匿名接口最多返回 **10 条**热门划线（登录态最多 20 条；全书全部热门划线仅在 App 内）。

## 🌐 公开网页 + 自动同步（GitHub Pages，可选）

仓库带一套「共享书库」机制：把书发到 GitHub Pages 公开网页上，**你能增删、别人只读**。

```
你编辑 data/watchlist.txt（加一行 bookId）
        │  提交
        ▼
GitHub Actions 自动抓取  ──►  data/books.json 更新
        │
        ▼
GitHub Pages 网页自动显示（任何人可浏览，只读）
```

### 增删数据（只有你能做）
- **加书**：编辑 `data/watchlist.txt` 加一行 bookId → 提交 → Actions 自动抓 → 网页出现这本书
- **删划线/删书**：本地工具里操作 → 点「🔄 同步共享书库」→ 更新 `data/books.json` + `data/deleted.json` → 提交 → 网页所有人看不到
  - 删除清单 `deleted.json` 保证 Actions 重抓时**删除不会复活**

### 开启 Pages（只需一次）
1. 仓库 `Settings` → `Pages` → Source 选 `Deploy from a branch`
2. Branch 选 `main`，目录 `/ (root)` → Save
3. 访问 `https://<用户名>.github.io/<仓库名>/`

### 网页与本地差异
- **本地（start.bat）**：可抓新书、可删除、可同步 —— 你的私人工作区
- **网页（Pages）**：只读展示共享书库 —— 给所有人看

## 🚀 快速开始

### 环境要求
- **Python 3.10+**（只用标准库，零第三方依赖）

### 运行
```bash
# Windows：双击 start.bat（自动检测 Python 并启动）
# 或手动：
python server.py
```

打开浏览器访问 `http://127.0.0.1:8000`，粘贴 bookId 即可使用。

### 获取 bookId
在微信读书网页版打开一本书，复制地址栏：
```
https://weread.qq.com/web/bookDetail/b35326a0813abab07g0115b3
```
`bookDetail/` 后面那串（`b35326a0813abab07g0115b3`）就是 bookId。

## 📁 文件结构

```
weread-highlights/
├─ index.html        # 页面（获取栏 / 左侧书单 / 右侧划线 / 同步栏）
├─ styles.css        # 样式
├─ app.js            # 前端逻辑（抓取 / 渲染 / 删选 / 导入导出 / 共享书库 / 同步）
├─ server.py         # 本地代理：匿名请求微信读书公开接口（纯标准库）
├─ start.bat         # 一键启动（Windows）
├─ data/
│  ├─ watchlist.txt  # 想自动抓取的 bookId 清单（你维护）
│  ├─ books.json     # 共享书库（Actions/同步自动生成）
│  └─ deleted.json   # 删除清单（防止删除复活，自动生成）
├─ scripts/
│  └─ fetch_books.py # 批量抓取脚本（本地与 CI 共用）
├─ .github/workflows/
│  └─ fetch.yml      # 自动同步工作流（每天 + watchlist 变更触发）
├─ samples/          # 示例数据（可导入体验）
├─ LICENSE           # MIT
└─ README.md
```

## 🔧 工作原理

1. 浏览器直接请求微信读书接口会被 **CORS 拦截**，所以前端先请求本地服务
2. `server.py` 匿名访问微信读书公开接口：
   - 访问 `weread.qq.com/web/bookDetail/<infoId>` 提取真实数字 bookId
   - 请求 `weread.qq.com/web/book/bestbookmarks?bookId=<数字ID>&hasLogin=0` 获取热门划线
3. 接口在 `hasLogin=0`（匿名）模式下**无需登录**即可返回热门划线摘要

## ⚖️ 免责声明

- 本项目仅用于个人学习与数据整理
- 数据版权归微信读书及其内容提供方所有，请勿用于商业用途
- 请遵守微信读书服务条款，控制请求频率

## 📜 License

[MIT](LICENSE)
