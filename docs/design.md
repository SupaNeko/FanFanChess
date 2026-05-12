# Design Document - 翻翻棋在线对战

## 1. 架构设计

### 1.1 整体架构
```
┌─────────────────────────────────────┐
│           Client (Browser)          │
│  ┌─────────┐  ┌─────────────────┐  │
│  │  UI Layer │  │  Game Logic     │  │
│  │  - Login  │  │  - Render       │  │
│  │  - Lobby  │  │  - Interaction  │  │
│  │  - Board  │  │  - Animation    │  │
│  └─────────┘  └─────────────────┘  │
│              WebSocket / HTTP       │
└─────────────────────────────────────┘
                   │
┌─────────────────────────────────────┐
│           Server (Node.js)          │
│  ┌─────────┐  ┌─────────┐ ┌──────┐ │
│  │ Express │  │  WS     │ │ SQLite│ │
│  │ Static  │  │ Server  │ │  DB   │ │
│  │  Files  │  │         │ │       │ │
│  └─────────┘  └─────────┘ └──────┘ │
│  ┌─────────┐  ┌─────────┐ ┌──────┐ │
│  │ Room    │  │ Game    │ │ User │ │
│  │ Manager │  │ Engine  │ │ Store│ │
│  └─────────┘  └─────────┘ └──────┘ │
└─────────────────────────────────────┘
```

### 1.2 技术选型理由
- **前端原生技术栈**：零依赖，浏览器直接运行，无需构建步骤，部署极简
- **Node.js + Express**：轻量HTTP服务器， serving 静态文件
- **ws (WebSocket)**：轻量级WebSocket实现，比Socket.IO依赖更少
- **SQLite3**：零配置数据库，单文件存储，适合小型应用

## 2. 后端设计

### 2.1 模块职责

#### server.js
- HTTP服务器启动
- Express静态文件服务
- WebSocket服务器挂载
- 消息路由分发

#### room.js
- 房间创建/销毁
- 玩家加入/离开
- 准备状态管理
- 观战者管理
- 邀请码生成（6位随机）

#### game.js
- 棋盘初始化（随机打乱）
- 移动合法性验证
- 吃子规则判定
- 翻棋处理
- 胜负判定
- 历史记录维护

#### db.js
- 数据库连接
- 用户表操作
- 对局记录存储
- 查询接口

### 2.2 核心数据结构

#### 棋子 (Piece)
```javascript
{
  id: number,
  type: 'shuai' | 'shi' | 'xiang' | 'ju' | 'ma' | 'pao' | 'bing',
  color: 'red' | 'black',
  flipped: boolean,
  position: { row: 0-3, col: 0-7 } | null
}
```

#### 棋盘 (Board)
```javascript
[
  [Piece|null, Piece|null, ...], // row 0
  [Piece|null, Piece|null, ...], // row 1
  [Piece|null, Piece|null, ...], // row 2
  [Piece|null, Piece|null, ...]  // row 3
]
```

#### 房间 (Room)
```javascript
{
  id: string,
  code: string,
  players: [string|null, string|null], // usernames
  spectators: string[],
  ready: [boolean, boolean],
  game: Game|null,
  status: 'waiting' | 'playing' | 'finished'
}
```

#### 游戏状态 (Game)
```javascript
{
  board: Board,
  currentPlayer: 0 | 1, // index into players
  playerColors: ['red' | 'black', 'red' | 'black'],
  history: Move[],
  status: 'flipping' | 'playing' | 'finished',
  winner: string|null,
  lastMove: Move|null
}
```

### 2.3 WebSocket 协议

所有消息格式：
```javascript
{
  type: string,
  data: object
}
```

#### 客户端 → 服务器
| 消息类型 | data | 说明 |
|----------|------|------|
| login | { username } | 用户登录 |
| create_room | {} | 创建房间 |
| join_room | { code } | 加入房间 |
| ready | { roomId } | 准备/取消准备 |
| flip | { roomId, row, col } | 翻棋 |
| move | { roomId, from, to } | 移动棋子 |
| surrender | { roomId } | 投降 |
| request_undo | { roomId } | 请求悔棋 |
| response_undo | { roomId, accept } | 响应悔棋 |

#### 服务器 → 客户端
| 消息类型 | data | 说明 |
|----------|------|------|
| login_success | { username } | 登录成功 |
| login_error | { message } | 登录失败 |
| room_created | { roomId, code } | 房间创建成功 |
| room_joined | { roomId, players, spectators, ready } | 加入房间成功 |
| room_update | { players, spectators, ready } | 房间状态更新 |
| game_started | { board, currentPlayer, playerColors } | 游戏开始 |
| coin_flip | { result } | 抛硬币结果（动画触发） |
| color_assigned | { color } | 分配颜色 |
| piece_flipped | { row, col, piece } | 棋子被翻开 |
| piece_moved | { from, to, piece } | 棋子移动 |
| piece_eaten | { from, to, eater, eaten } | 吃子 |
| both_eaten | { from, to, piece1, piece2 } | 同归于尽 |
| turn_changed | { currentPlayer } | 回合切换 |
| undo_requested | { requester } | 悔棋请求 |
| undo_accepted | {} | 悔棋成功 |
| game_over | { winner, reason } | 游戏结束 |
| error | { message } | 错误提示 |

## 3. 前端设计

### 3.1 单页应用结构
所有界面在一个HTML文件中，通过JS切换显示。

#### 视图列表
1. `login-view`: 登录界面
2. `mode-view`: 模式选择
3. `lobby-view`: 联机大厅（创建/加入）
4. `room-view`: 房间等待
5. `game-view`: 游戏界面

### 3.2 棋盘渲染
- 使用HTML div网格布局
- 4行 × 8列 = 32个格子
- 每个格子包含：
  - 背景（木质纹理或纯色）
  - 棋子div（圆形，背面/正面）
  - 高亮层（选中、上一步、可移动）

### 3.3 棋子样式
- 圆形棋子，红方红色，黑方黑色/深色
- 未翻开：显示统一背面（问号或棋盘纹）
- 已翻开：显示棋子名称

### 3.4 动画设计
- **抛硬币**：CSS 3D旋转动画，3秒后显示结果
- **翻棋**：CSS flip动画，Y轴旋转180度
- **移动**：CSS transition，位置平滑移动
- **吃子**：被吃棋子缩小消失 + 粒子效果（可选简化）

### 3.5 响应式
- 最小支持 1024x768
- 棋盘居中，两侧棋子统计自适应宽度
- 移动端提示：建议横屏或PC访问

## 4. 游戏逻辑详细设计

### 4.1 初始化流程
```
1. 生成32个棋子（16红 + 16黑）
2. Fisher-Yates 洗牌算法随机分配到32个位置
3. 所有棋子 flipped = false
```

### 4.2 先手判定（联机）
```
1. 双方都准备后，server生成随机数 0 或 1
2. 广播 coin_flip 消息
3. 前端播放抛硬币动画（约3秒）
4. 动画结束后，server广播 color_assigned
5. 先手玩家回合，状态设为 'flipping'
```

### 4.3 颜色绑定
```
1. 先手玩家翻棋
2. 翻出的棋子颜色 → 先手玩家的阵营
3. 后手自动获得相反颜色
4. 状态切换为 'playing'
```

### 4.4 移动验证
```
function isValidMove(board, from, to, playerColor):
  1. 边界检查
  2. from 位置必须有已翻开且属于playerColor的棋子
  3. to 位置必须为空或有对方已翻开棋子
  4. 如果是炮：
     - 不吃子：只能横竖一格
     - 吃子：必须隔恰好一个棋子（横竖方向）
  5. 其他棋子：只能横竖一格
  6. 吃子时：目标必须是对方已翻开棋子
```

### 4.5 吃子判定
```
function canEat(attacker, defender):
  if attacker.type == 'pao':
    return true // 炮隔子吃可以吃任何棋子
  
  // 大小顺序: shuai > shi > xiang > ma > ju > pao > bing
  const ranks = { shuai: 7, shi: 6, xiang: 5, ma: 4, ju: 3, pao: 2, bing: 1 }
  
  if attacker.type == 'bing' && defender.type == 'shuai':
    return true // 兵吃帅
  if attacker.type == 'shuai' && defender.type == 'bing':
    return false // 帅不能吃兵
  
  if ranks[attacker.type] == ranks[defender.type]:
    return 'both' // 同归于尽
  
  return ranks[attacker.type] > ranks[defender.type]
```

### 4.6 悔棋逻辑
```
1. 玩家A发送 request_undo
2. Server广播 undo_requested 给玩家B
3. 玩家B发送 response_undo { accept: true/false }
4. 如果 accept:
   - 回退board到上一步状态
   - 从历史记录中移除最后一步
   - 广播 undo_accepted
   - 回合回退到操作前
```

## 5. 数据库设计

### 5.1 表结构

```sql
-- 用户表
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 对局记录表
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  red_player TEXT NOT NULL,
  black_player TEXT NOT NULL,
  winner TEXT,
  win_reason TEXT,
  moves TEXT NOT NULL, -- JSON array
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 6. 部署方案

### 6.1 启动方式
```bash
# 安装依赖（首次）
cd backend
npm install

# 启动服务
npm start
# 或
node server.js
```

### 6.2 访问方式
- 默认端口：3000
- 访问地址：http://localhost:3000
- 部署后：http://<domain>:3000 或配置反向代理到80端口

### 6.3 环境要求
- Node.js >= 14.0.0
- npm >= 6.0.0
