# 翻翻棋在线对战

一个轻量化的网页端翻翻棋对战游戏，支持本地对战和在线联机对战。

## 项目结构

```
FanfanChess/
├── backend/          # 后端代码 (Node.js)
│   ├── server.js     # 主服务器 (HTTP + WebSocket)
│   ├── game.js       # 游戏逻辑引擎
│   ├── room.js       # 房间管理系统
│   ├── db.js         # SQLite 数据库操作
│   └── package.json  # Node.js 依赖配置
├── frontend/         # 前端代码 (原生 HTML/CSS/JS)
│   ├── index.html    # 单页应用入口
│   ├── css/
│   │   └── style.css # 样式文件
│   └── js/
│       └── app.js    # 前端主逻辑
├── docs/             # 开发文档
│   ├── PRD.md        # 产品需求文档
│   ├── feature_list.md # 功能清单
│   └── design.md     # 设计文档
├── README.md         # 本文件
└── .gitignore        # Git 忽略配置
```

## 技术栈

- **前端**：原生 HTML5 + CSS3 + JavaScript（零框架依赖）
- **后端**：Node.js + Express + ws (WebSocket) + sqlite3
- **数据库**：SQLite（单文件，零配置）

## 快速开始

### 环境要求

- Node.js >= 14.0.0
- npm >= 6.0.0

### 安装与启动

```bash
# 进入后端目录
cd backend

# 安装依赖（首次运行）
npm install

# 启动服务器
npm start
```

服务启动后，访问：

```
http://localhost:3000
```

### 部署说明

在 Linux/Windows 服务器上：

```bash
cd backend
npm install
npm start
```

默认监听端口 `3000`，可通过环境变量修改：

```bash
PORT=8080 npm start
```

如需使用域名访问，建议配合 Nginx 反向代理。

## 游戏规则

1. **棋子大小**：帅 > 仕 > 相 > 馬 > 車 > 炮 > 兵
2. **特殊规则**：帅不能吃兵，兵可以吃帅
3. **移动规则**：所有棋子横竖走一格
4. **炮的规则**：不吃子时走一格；吃子时隔恰好一子，可吃任何已翻开棋子
5. **翻棋规则**：点击未翻开棋子可翻开，无位置限制
6. **同归于尽**：相同大小棋子互吃时同时消失（炮除外）
7. **胜负**：吃光对方棋子获胜；双方无子为和局

## 功能特性

- [x] 用户名登录（无需密码）
- [x] 本地模式（单人双角色）
- [x] 联机模式（房间 + 6位邀请码）
- [x] 观战模式
- [x] 准备阶段
- [x] 抛硬币决定先后手
- [x] 实时对战
- [x] 悔棋功能（需对方同意）
- [x] 投降功能
- [x] 对局记录存储
- [x] 规则浮窗提示
- [x] 上一步操作提示
- [x] 剩余棋子统计

## 开发者

自主开发项目，文档详见 `docs/` 目录。
