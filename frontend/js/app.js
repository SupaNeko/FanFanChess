/**
 * 翻翻棋 - 前端主应用
 * 包含：WebSocket通信、本地/联机游戏逻辑、UI渲染
 */

// ==================== 全局状态 ====================
const AppState = {
  username: null,
  ws: null,
  currentView: 'login-view',
  mode: null, // 'local' | 'online'
  room: null,
  game: null, // 当前游戏状态
  selectedPiece: null,
  isMyTurn: false,
  myColor: null,
  playerIndex: -1, // 在房间中的玩家索引
  reconnectAttempts: 0
};

// 棋子大小顺序（用于统计排序）
const PIECE_ORDER = ['shuai', 'shi', 'xiang', 'ma', 'ju', 'pao', 'bing'];
const PIECE_NAMES = {
  red: { shuai: '帅', shi: '仕', xiang: '相', ma: '馬', ju: '車', pao: '炮', bing: '兵' },
  black: { shuai: '将', shi: '士', xiang: '象', ma: '馬', ju: '車', pao: '砲', bing: '卒' }
};

// ==================== Toast 消息提示 ====================
let toastTimer = null;

function showToast(message, type = 'error') {
  const el = document.getElementById('toast-message');
  el.textContent = message;
  el.className = 'toast-message ' + type;
  el.style.display = 'block';

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    hideToast();
  }, 3000);
}

function hideToast() {
  const el = document.getElementById('toast-message');
  if (!el || el.style.display === 'none') return;
  el.classList.add('hiding');
  setTimeout(() => {
    el.style.display = 'none';
    el.classList.remove('hiding');
    el.textContent = '';
  }, 300);
}

// ==================== WebSocket 管理 ====================
let heartbeatInterval = null;
let heartbeatTimeout = null;
const HEARTBEAT_INTERVAL = 30000; // 30秒发送一次ping
const HEARTBEAT_TIMEOUT = 90000;  // 90秒未收到消息则重连

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
      send('ping', {});
    }
  }, HEARTBEAT_INTERVAL);
  resetHeartbeatTimeout();
}

function resetHeartbeatTimeout() {
  if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
  heartbeatTimeout = setTimeout(() => {
    console.log('心跳超时，主动重连');
    if (AppState.ws) {
      AppState.ws.close();
    }
  }, HEARTBEAT_TIMEOUT);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (heartbeatTimeout) {
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = null;
  }
}

function connectWebSocket() {
  // 避免重复创建连接
  if (AppState.ws && (AppState.ws.readyState === WebSocket.CONNECTING || AppState.ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  AppState.ws = new WebSocket(wsUrl);

  AppState.ws.onopen = () => {
    console.log('WebSocket 连接成功');
    AppState.reconnectAttempts = 0;
    startHeartbeat();

    // 自动恢复登录（重连场景）
    const savedUsername = sessionStorage.getItem('fanfan_username');
    if (savedUsername && !AppState.username) {
      send('login', { username: savedUsername });
    }
  };

  AppState.ws.onmessage = (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      // 收到任何消息都重置心跳超时
      resetHeartbeatTimeout();
      handleServerMessage(type, data);
    } catch (e) {
      console.error('解析消息失败:', e);
    }
  };

  AppState.ws.onclose = () => {
    console.log('WebSocket 连接关闭');
    stopHeartbeat();
    // 尝试重连
    if (AppState.reconnectAttempts < 3) {
      AppState.reconnectAttempts++;
      setTimeout(connectWebSocket, 2000);
    }
  };

  AppState.ws.onerror = (err) => {
    console.error('WebSocket 错误:', err);
  };
}

// 页面可见性变化监听（切回前台时检测连接）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // 切回前台，检查连接状态
    if (!AppState.ws || AppState.ws.readyState !== WebSocket.OPEN) {
      showToast('连接已断开，正在恢复...', 'info');
      connectWebSocket();
    }
  }
});

function send(type, data = {}) {
  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({ type, data }));
  }
}

// ==================== 服务器消息处理 ====================
function handleServerMessage(type, data) {
  console.log('[Server]', type, data);

  switch (type) {
    case 'login_success':
      AppState.username = data.username;
      sessionStorage.setItem('fanfan_username', data.username);
      switchView('mode-view');
      document.getElementById('user-name').textContent = data.username;

      // 如果之前有房间（重连/刷新场景），尝试重新加入
      const savedRoomCode = sessionStorage.getItem('fanfan_room_code');
      if (savedRoomCode) {
        setTimeout(() => {
          send('join_room', { code: savedRoomCode });
        }, 300);
      }
      break;

    case 'login_error':
      showToast(data.message, 'error');
      break;

    case 'room_created':
      AppState.room = data;
      AppState.playerIndex = data.playerIndex;
      sessionStorage.setItem('fanfan_room_code', data.code);
      showRoomView(data);
      break;

    case 'room_joined':
      AppState.room = data;
      AppState.playerIndex = data.playerIndex;
      sessionStorage.setItem('fanfan_room_code', data.code);
      if (data.gameState) {
        // 观战者加入正在进行的游戏，直接进入对局
        startSpectatorGame(data.gameState);
        if (data.spectators) {
          renderSpectatorBar(data.spectators);
        }
      } else {
        showRoomView(data);
      }
      break;

    case 'room_update':
      if (AppState.room) {
        AppState.room.players = data.players;
        AppState.room.spectators = data.spectators;
        AppState.room.ready = data.ready;
        AppState.room.status = data.status;
      }
      if (AppState.currentView === 'room-view') {
        updateRoomView(data);
      } else if (AppState.currentView === 'game-view') {
        renderSpectatorBar(data.spectators);
      }
      break;

    case 'coin_flip':
      // 观战者不显示抛硬币动画
      if (AppState.playerIndex !== -1) {
        showCoinFlip(data.result);
      }
      break;

    case 'game_started':
      AppState.pendingGame = data;
      if (AppState.waitingForGameStart) {
        startOnlineGame(data);
        AppState.pendingGame = null;
        AppState.waitingForGameStart = false;
      } else if (AppState.playerIndex === -1) {
        // 观战者自动进入新一局
        startOnlineGame(data);
        AppState.pendingGame = null;
      }
      break;

    case 'piece_flipped':
      handlePieceFlipped(data);
      break;

    case 'piece_moved':
      handlePieceMoved(data);
      break;

    case 'piece_eaten':
      handlePieceEaten(data);
      break;

    case 'both_eaten':
      handleBothEaten(data);
      break;

    case 'undo_requested':
      showUndoRequest(data.requester);
      break;

    case 'undo_accepted':
      hideToast();
      handleUndoAccepted(data);
      showToast('对方同意了你的悔棋请求', 'success');
      break;

    case 'undo_rejected':
      hideToast();
      showToast('对方拒绝了你的悔棋请求', 'error');
      break;

    case 'game_over':
      handleGameOver(data);
      break;

    case 'left_room':
      AppState.room = null;
      AppState.game = null;
      sessionStorage.removeItem('fanfan_room_code');
      switchView('lobby-view');
      break;

    case 'local_game_started':
      startLocalGame(data);
      break;

    case 'room_reset':
      AppState.game = null;
      AppState.selectedPiece = null;
      AppState.room = { ...AppState.room, ...data };
      if (AppState.playerIndex === -1) {
        // 观战者回到房间等待下一局
        showRoomView(data);
      } else {
        showRoomView(data);
      }
      break;

    case 'room_full': {
      showConfirm('房间已满', '该房间已满员，是否要以观战模式进入？', () => {
        send('join_room', { code: data.code });
      }, 'btn-primary');
      break;
    }

    case 'error':
      showToast(data.message, 'error');
      // 房间已被删除（如创建者离开后房间解散），清理状态返回大厅
      if (data.message === '房间不存在') {
        AppState.room = null;
        AppState.game = null;
        sessionStorage.removeItem('fanfan_room_code');
        switchView('lobby-view');
      }
      break;
  }
}

// ==================== 视图切换 ====================
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  AppState.currentView = viewId;
}

// ==================== 登录页逻辑 ====================
document.getElementById('login-btn').addEventListener('click', () => {
  const username = document.getElementById('username-input').value.trim();
  if (!username) {
    showToast('请输入用户名', 'error');
    return;
  }
  send('login', { username });
});

document.getElementById('username-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('login-btn').click();
  }
});

// ==================== 模式选择逻辑 ====================
document.getElementById('local-mode-btn').addEventListener('click', () => {
  AppState.mode = 'local';
  send('local_start', {});
});

document.getElementById('online-mode-btn').addEventListener('click', () => {
  AppState.mode = 'online';
  switchView('lobby-view');
});

document.getElementById('logout-btn').addEventListener('click', () => {
  AppState.username = null;
  AppState.mode = null;
  AppState.room = null;
  AppState.game = null;
  sessionStorage.removeItem('fanfan_username');
  sessionStorage.removeItem('fanfan_room_code');
  document.getElementById('username-input').value = '';
  switchView('login-view');
});

// ==================== 联机大厅逻辑 ====================
document.getElementById('create-room-btn').addEventListener('click', () => {
  send('create_room', {});
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (code.length !== 6) {
    showToast('邀请码为6位字符', 'error');
    return;
  }
  send('join_room', { code });
});

document.getElementById('lobby-back-btn').addEventListener('click', () => {
  switchView('mode-view');
});

// ==================== 房间页逻辑 ====================
function showRoomView(data) {
  switchView('room-view');
  document.getElementById('room-code-display').textContent = data.code;
  updateRoomView(data);
}

function updateRoomView(data) {
  const p0 = data.players[0];
  const p1 = data.players[1];

  document.getElementById('player-0-name').textContent = p0 || '等待加入...';
  document.getElementById('player-1-name').textContent = p1 || '等待加入...';

  const slot0 = document.getElementById('player-0-slot');
  const slot1 = document.getElementById('player-1-slot');

  slot0.classList.toggle('ready', !!data.ready[0]);
  slot1.classList.toggle('ready', !!data.ready[1]);

  document.getElementById('player-0-status').textContent = p0 ? (data.ready[0] ? '已准备' : '未准备') : '';
  document.getElementById('player-1-status').textContent = p1 ? (data.ready[1] ? '已准备' : '未准备') : '';

  // 观战者
  const specArea = document.getElementById('spectators-area');
  if (data.spectators && data.spectators.length > 0) {
    specArea.style.display = 'block';
    document.getElementById('spectators-list').textContent = data.spectators.join('、');
  } else {
    specArea.style.display = 'none';
  }

  // 更新房间状态
  if (data.status === 'playing' || data.status === 'finished' || AppState.playerIndex === -1) {
    document.getElementById('ready-btn').style.display = 'none';
  } else {
    document.getElementById('ready-btn').style.display = 'inline-block';
  }
}

document.getElementById('ready-btn').addEventListener('click', () => {
  if (!AppState.room) return;
  send('ready', { roomId: AppState.room.roomId });
});

document.getElementById('leave-room-btn').addEventListener('click', () => {
  send('leave_room', {});
});

document.getElementById('copy-code-btn').addEventListener('click', () => {
  const code = document.getElementById('room-code-display').textContent;

  function fallbackCopy() {
    const input = document.createElement('input');
    input.value = code;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.focus();
    input.select();
    try {
      document.execCommand('copy');
      showToast('邀请码已复制：' + code, 'success');
    } catch (err) {
      showToast('复制失败，请手动复制：' + code, 'error');
    }
    document.body.removeChild(input);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(() => {
      showToast('邀请码已复制：' + code, 'success');
    }).catch(() => {
      fallbackCopy();
    });
  } else {
    fallbackCopy();
  }
});

// ==================== 通用确认弹窗 ====================
function showConfirm(title, message, onYes, yesClass = 'btn-danger') {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const yesBtn = document.getElementById('confirm-yes-btn');
  const noBtn = document.getElementById('confirm-no-btn');
  yesBtn.className = yesClass;
  yesBtn.onclick = () => {
    document.getElementById('confirm-modal').style.display = 'none';
    onYes();
  };
  noBtn.onclick = () => {
    document.getElementById('confirm-modal').style.display = 'none';
  };
  document.getElementById('confirm-modal').style.display = 'flex';
}

// ==================== 观战者提示条 ====================
function renderSpectatorBar(spectators) {
  const bar = document.getElementById('spectator-bar');
  const text = document.getElementById('spectator-bar-text');
  if (spectators && spectators.length > 0) {
    bar.style.display = 'block';
    text.textContent = spectators.join('、') + ' 在观战';
  } else {
    bar.style.display = 'none';
  }
}

// ==================== 观战者加入游戏 ====================
function startSpectatorGame(gameState) {
  AppState.game = {
    board: deserializeBoard(gameState.board),
    currentPlayer: gameState.currentPlayer,
    firstPlayer: gameState.firstPlayer,
    playerColors: gameState.playerColors,
    status: gameState.status,
    lastMove: null,
    mode: 'online'
  };
  AppState.myColor = null;
  AppState.isMyTurn = false;
  AppState.selectedPiece = null;
  AppState.waitingForGameStart = false;

  switchView('game-view');
  renderGame();
}

// ==================== 观战者游戏结束弹窗 ====================
function showSpectatorGameOver(data) {
  const titleEl = document.getElementById('game-over-title');
  const msgEl = document.getElementById('game-over-message');

  if (data.winner === null) {
    titleEl.textContent = '和局';
    msgEl.textContent = data.reason || '双方无子';
  } else {
    const winnerColor = data.winner;
    titleEl.textContent = winnerColor === 'red' ? '红方胜利' : '黑方胜利';
    const winnerName = data.winnerName || (winnerColor === 'red' ? '红方' : '黑方');
    msgEl.textContent = `${winnerName}（${winnerColor === 'red' ? '红方' : '黑方'}）赢得了对局`;
  }

  document.getElementById('play-again-btn').textContent = '继续观战';
  document.getElementById('back-to-lobby-btn').textContent = '退出';
  document.getElementById('game-over-modal').style.display = 'flex';
}
function showCoinFlip(result) {
  const overlay = document.getElementById('coin-flip-overlay');
  const frontFace = document.querySelector('.coin-front');
  const backFace = document.querySelector('.coin-back');
  const text = document.getElementById('coin-result-text');

  overlay.style.display = 'flex';
  text.textContent = '决定先后手...';
  frontFace.style.opacity = '1';
  backFace.style.opacity = '0';

  const duration = 1500;
  const toggles = 14;
  let count = 0;
  let showingFront = true;

  function nextToggle() {
    count++;
    if (count > toggles) {
      // 强制停留在正确面
      const isFirst = result === AppState.playerIndex;
      frontFace.style.opacity = isFirst ? '1' : '0';
      backFace.style.opacity = isFirst ? '0' : '1';
      text.textContent = isFirst ? '您先手！' : '您后手！';

      setTimeout(() => {
        overlay.style.display = 'none';
        switchView('game-view');
        if (AppState.pendingGame) {
          startOnlineGame(AppState.pendingGame);
          AppState.pendingGame = null;
        } else {
          AppState.waitingForGameStart = true;
        }
      }, 1000);
      return;
    }

    showingFront = !showingFront;
    frontFace.style.opacity = showingFront ? '1' : '0';
    backFace.style.opacity = showingFront ? '0' : '1';

    // 间隔从快到慢：30ms → 300ms
    const progress = count / toggles;
    const delay = 30 + 270 * progress;
    setTimeout(nextToggle, delay);
  }

  nextToggle();
}

// ==================== 游戏初始化 ====================
function startOnlineGame(data) {
  AppState.game = {
    board: deserializeBoard(data.board),
    currentPlayer: data.currentPlayer,
    firstPlayer: data.firstPlayer,
    playerColors: data.playerColors || [null, null],
    status: data.status,
    lastMove: null,
    mode: 'online'
  };

  // 确定我的颜色
  if (AppState.playerIndex >= 0 && data.playerColors) {
    AppState.myColor = data.playerColors[AppState.playerIndex];
  }

  AppState.isMyTurn = data.currentPlayer === AppState.playerIndex;
  AppState.selectedPiece = null;

  switchView('game-view');
  renderGame();
}

function startLocalGame(data) {
  AppState.game = {
    board: deserializeBoard(data.board),
    currentPlayer: data.firstPlayer,
    firstPlayer: data.firstPlayer,
    playerColors: [null, null],
    status: 'flipping',
    lastMove: null,
    mode: 'local',
    localFlipped: false // 标记是否已经翻棋确定颜色
  };

  AppState.myColor = null;
  AppState.isMyTurn = true; // 本地模式总是可以操作
  AppState.selectedPiece = null;
  AppState.playerIndex = data.firstPlayer; // 当前操作的是先手

  switchView('game-view');
  renderGame();

  // 本地模式也显示抛硬币
  showCoinFlip(data.firstPlayer);
}

function deserializeBoard(serializedBoard) {
  return serializedBoard.map(row =>
    row.map(piece =>
      piece ? { ...piece, row: piece.row, col: piece.col } : null
    )
  );
}

// ==================== 棋盘渲染 ====================
function renderGame() {
  if (!AppState.game) return;

  if (AppState.playerIndex === -1 && AppState.room) {
    renderSpectatorBar(AppState.room.spectators || []);
  }

  // 观战者隐藏悔棋和投降按钮
  const isSpectator = AppState.playerIndex === -1;
  document.getElementById('undo-btn').style.display = isSpectator ? 'none' : '';
  document.getElementById('surrender-btn').style.display = isSpectator ? 'none' : '';

  renderBoard();
  renderPiecesCount();
  renderHeader();
  renderLastMove();
}

function renderBoard() {
  const boardEl = document.getElementById('chess-board');
  boardEl.innerHTML = '';

  const game = AppState.game;

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;

      const piece = game.board[row][col];

      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece';

        if (piece.flipped) {
          pieceEl.classList.add(piece.color);
          pieceEl.textContent = piece.name;
        } else {
          pieceEl.classList.add('back');
        }

        pieceEl.dataset.row = row;
        pieceEl.dataset.col = col;
        pieceEl.dataset.pieceId = piece.id;

        cell.appendChild(pieceEl);
      }

      // 高亮选中
      if (AppState.selectedPiece && AppState.selectedPiece.row === row && AppState.selectedPiece.col === col) {
        cell.classList.add('selected');
      }

      // 高亮上一步
      if (game.lastMove) {
        if (game.lastMove.type === 'flip') {
          if (game.lastMove.row === row && game.lastMove.col === col) {
            cell.classList.add('last-move');
          }
        } else {
          if ((game.lastMove.from.row === row && game.lastMove.from.col === col) ||
              (game.lastMove.to.row === row && game.lastMove.to.col === col)) {
            cell.classList.add('last-move');
          }
        }
      }

      cell.addEventListener('click', () => handleCellClick(row, col));
      boardEl.appendChild(cell);
    }
  }
}

function renderPiecesCount() {
  const game = AppState.game;
  if (!game) return;

  const redCounts = {};
  const blackCounts = {};

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = game.board[row][col];
      if (piece) {
        // 统计所有剩余棋子（包括未翻开的）
        if (piece.color === 'red') {
          redCounts[piece.type] = (redCounts[piece.type] || 0) + 1;
        } else {
          blackCounts[piece.type] = (blackCounts[piece.type] || 0) + 1;
        }
      }
    }
  }

  renderSidePanel('red-pieces-count', redCounts, 'red');
  renderSidePanel('black-pieces-count', blackCounts, 'black');
}

function renderSidePanel(elementId, counts, color) {
  const container = document.getElementById(elementId);
  container.innerHTML = '';

  for (const type of PIECE_ORDER) {
    const count = counts[type] || 0;
    if (count > 0) {
      const item = document.createElement('div');
      item.className = 'piece-count-item';

      const mini = document.createElement('div');
      mini.className = `mini-piece ${color}`;
      mini.textContent = PIECE_NAMES[color][type];

      const num = document.createElement('span');
      num.textContent = `×${count}`;

      item.appendChild(mini);
      item.appendChild(num);
      container.appendChild(item);
    }
  }

  if (container.children.length === 0) {
    container.innerHTML = '<span style="color:#999;font-size:12px;">无</span>';
  }
}

function renderHeader() {
  const game = AppState.game;
  const myColorEl = document.getElementById('my-color');
  const turnEl = document.getElementById('turn-indicator');

  if (game.mode === 'local') {
    myColorEl.style.display = 'none';
    const currentColor = game.playerColors[game.currentPlayer];
    if (currentColor) {
      turnEl.textContent = `${currentColor === 'red' ? '红方' : '黑方'}回合`;
    } else {
      turnEl.textContent = '请翻棋确定阵营';
    }
    turnEl.classList.remove('my-turn');
  } else {
    myColorEl.style.display = 'inline-block';
    if (AppState.playerIndex === -1) {
      myColorEl.textContent = '观战中';
      myColorEl.className = '';
    } else if (AppState.myColor) {
      myColorEl.textContent = AppState.myColor === 'red' ? '红方' : '黑方';
      myColorEl.className = AppState.myColor;
    } else {
      myColorEl.textContent = '未确定';
      myColorEl.className = '';
    }

    if (game.status === 'flipping') {
      if (AppState.playerIndex === -1) {
        turnEl.textContent = '玩家翻棋中...';
        turnEl.classList.remove('my-turn');
      } else {
        turnEl.textContent = game.currentPlayer === AppState.playerIndex ? '请翻棋确定阵营' : '对方翻棋中...';
        turnEl.classList.toggle('my-turn', game.currentPlayer === AppState.playerIndex);
      }
    } else if (game.status === 'playing') {
      if (AppState.playerIndex === -1) {
        const currentColor = game.playerColors[game.currentPlayer];
        turnEl.textContent = currentColor === 'red' ? '红方回合' : '黑方回合';
      } else {
        turnEl.textContent = AppState.isMyTurn ? '你的回合' : '对方回合';
      }
      turnEl.classList.toggle('my-turn', AppState.isMyTurn);
    } else {
      turnEl.textContent = '游戏结束';
      turnEl.classList.remove('my-turn');
    }
  }
}

function renderLastMove() {
  const hintEl = document.getElementById('last-move-hint');
  const game = AppState.game;

  if (!game.lastMove) {
    hintEl.textContent = '';
    return;
  }

  const move = game.lastMove;
  let text = '';

  // 判断上一步是谁走的
  const prevPlayer = 1 - game.currentPlayer;
  let who = '';

  if (game.mode === 'local') {
    const prevColor = game.playerColors[prevPlayer];
    who = prevColor === 'red' ? '红方' : (prevColor === 'black' ? '黑方' : '');
  } else {
    // 联机模式
    if (AppState.playerIndex === -1) {
      // 观战者，显示颜色
      const prevColor = game.playerColors[prevPlayer];
      who = prevColor === 'red' ? '红方' : (prevColor === 'black' ? '黑方' : '');
    } else if (prevPlayer === AppState.playerIndex) {
      who = '你';
    } else {
      who = '对方';
    }
  }

  if (move.type === 'flip') {
    text = `${who}翻开了 ${move.piece.name}`;
  } else if (move.type === 'move') {
    text = `${who}移动了 ${move.piece.name}`;
  } else if (move.type === 'eat') {
    text = `${who}用 ${move.piece.name} 吃掉了 ${move.eaten.name}`;
  } else if (move.type === 'both_eaten') {
    text = `${who} ${move.piece1.name} 与 ${move.piece2.name} 同归于尽`;
  }

  hintEl.textContent = text;
}

// ==================== 游戏交互 ====================
function handleCellClick(row, col) {
  const game = AppState.game;
  if (!game) return;

  if (game.status === 'finished') return;

  const piece = game.board[row][col];

  // 联机模式：检查是否轮到当前玩家
  if (game.mode === 'online') {
    if (!AppState.isMyTurn) return;
    if (game.status === 'flipping' && AppState.playerIndex !== game.currentPlayer) return;
  }

  // 如果点击的是未翻开棋子
  if (piece && !piece.flipped) {
    hideToast();
    // 翻棋阶段只能翻棋
    if (game.status === 'flipping') {
      if (game.mode === 'online') {
        send('flip', { roomId: AppState.room.roomId, row, col });
      } else {
        handleLocalFlip(row, col);
      }
      return;
    }

    // 普通翻棋
    if (game.mode === 'online') {
      send('flip', { roomId: AppState.room.roomId, row, col });
    } else {
      handleLocalFlip(row, col);
    }
    return;
  }

  // 如果已经有选中的棋子
  if (AppState.selectedPiece) {
    const from = AppState.selectedPiece;

    // 点击同一位置，取消选中
    if (from.row === row && from.col === col) {
      AppState.selectedPiece = null;
      hideToast();
      renderBoard();
      return;
    }

    // 尝试移动或吃子
    hideToast();
    if (game.mode === 'online') {
      send('move', {
        roomId: AppState.room.roomId,
        from: { row: from.row, col: from.col },
        to: { row, col }
      });
    } else {
      handleLocalMove(from.row, from.col, row, col);
    }

    AppState.selectedPiece = null;
    return;
  }

  // 选中一个已翻开的己方棋子
  if (piece && piece.flipped) {
    const isMyPiece = game.mode === 'local'
      ? piece.color === game.playerColors[game.currentPlayer]
      : piece.color === AppState.myColor;

    if (isMyPiece) {
      hideToast();
      AppState.selectedPiece = { row, col, piece };
      renderBoard();
    }
  }
}

// ==================== 本地模式逻辑 ====================
function handleLocalFlip(row, col) {
  const game = AppState.game;
  const piece = game.board[row][col];

  if (!piece || piece.flipped) return;

  piece.flipped = true;

  // 翻棋动画效果
  const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (cell) {
    const pieceEl = cell.querySelector('.piece');
    if (pieceEl) {
      pieceEl.classList.add('flipping');
      setTimeout(() => pieceEl.classList.remove('flipping'), 600);
    }
  }

  if (game.status === 'flipping') {
    // 确定颜色绑定
    game.playerColors[game.currentPlayer] = piece.color;
    game.playerColors[1 - game.currentPlayer] = piece.color === 'red' ? 'black' : 'red';
    game.status = 'playing';
    game.localFlipped = true;
  }

  game.lastMove = { type: 'flip', row, col, piece };
  game.currentPlayer = 1 - game.currentPlayer;

  renderGame();
}

function handleLocalMove(fromRow, fromCol, toRow, toCol) {
  const game = AppState.game;
  const piece = game.board[fromRow][fromCol];
  const target = game.board[toRow][toCol];

  if (!piece) return;

  const playerColor = game.playerColors[game.currentPlayer];
  const result = validateLocalMove(game.board, fromRow, fromCol, toRow, toCol, playerColor);

  if (!result.valid) {
    showToast(result.reason, 'error');
    return;
  }

  if (result.eat === 'both') {
    game.board[toRow][toCol] = null;
    game.board[fromRow][fromCol] = null;
    game.lastMove = { type: 'both_eaten', from: {row: fromRow, col: fromCol}, to: {row: toRow, col: toCol}, piece1: piece, piece2: target };
  } else if (result.eat) {
    game.board[toRow][toCol] = piece;
    game.board[fromRow][fromCol] = null;
    piece.row = toRow;
    piece.col = toCol;
    game.lastMove = { type: 'eat', from: {row: fromRow, col: fromCol}, to: {row: toRow, col: toCol}, piece, eaten: target };
  } else {
    game.board[toRow][toCol] = piece;
    game.board[fromRow][fromCol] = null;
    piece.row = toRow;
    piece.col = toCol;
    game.lastMove = { type: 'move', from: {row: fromRow, col: fromCol}, to: {row: toRow, col: toCol}, piece };
  }

  game.currentPlayer = 1 - game.currentPlayer;

  // 检查游戏结束
  const gameOver = checkLocalGameOver(game.board);
  if (gameOver.over) {
    game.status = 'finished';
    showGameOver(gameOver.winner, gameOver.reason);
  }

  renderGame();
}

function validateLocalMove(board, fromRow, fromCol, toRow, toCol, playerColor) {
  // 边界检查
  if (toRow < 0 || toRow >= 4 || toCol < 0 || toCol >= 8) {
    return { valid: false, reason: '目标位置超出棋盘' };
  }

  const piece = board[fromRow][fromCol];
  if (!piece || !piece.flipped || piece.color !== playerColor) {
    return { valid: false, reason: '不能移动这个棋子' };
  }

  const target = board[toRow][toCol];
  const dr = Math.abs(toRow - fromRow);
  const dc = Math.abs(toCol - fromCol);
  const isAdj = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);

  // 炮的特殊处理
  if (piece.type === 'pao') {
    if (fromRow !== toRow && fromCol !== toCol) {
      return { valid: false, reason: '炮只能横竖移动' };
    }

    let between = 0;
    if (fromRow === toRow) {
      const min = Math.min(fromCol, toCol);
      const max = Math.max(fromCol, toCol);
      for (let c = min + 1; c < max; c++) {
        if (board[fromRow][c]) between++;
      }
    } else {
      const min = Math.min(fromRow, toRow);
      const max = Math.max(fromRow, toRow);
      for (let r = min + 1; r < max; r++) {
        if (board[r][fromCol]) between++;
      }
    }

    if (!target) {
      if (!isAdj) return { valid: false, reason: '炮不吃子时只能走一格' };
      return { valid: true };
    }

    if (target.flipped && target.color !== playerColor) {
      if (between !== 1) return { valid: false, reason: '炮吃子必须隔恰好一个棋子' };
      return { valid: true, eat: true };
    }

    return { valid: false, reason: '目标位置不能到达' };
  }

  // 其他棋子
  if (!isAdj) {
    return { valid: false, reason: '只能横竖移动一格' };
  }

  if (!target) {
    return { valid: true };
  }

  if (!target.flipped) {
    return { valid: false, reason: '不能吃未翻开的棋子' };
  }

  if (target.color === playerColor) {
    return { valid: false, reason: '不能吃自己的棋子' };
  }

  const ranks = { shuai: 7, shi: 6, xiang: 5, ma: 4, ju: 3, pao: 2, bing: 1 };

  if (piece.type === 'bing' && target.type === 'shuai') {
    return { valid: true, eat: true };
  }
  if (piece.type === 'shuai' && target.type === 'bing') {
    return { valid: false, reason: '帅不能吃兵' };
  }

  if (ranks[piece.type] === ranks[target.type]) {
    return { valid: true, eat: 'both' };
  }

  if (ranks[piece.type] > ranks[target.type]) {
    return { valid: true, eat: true };
  }

  return { valid: false, reason: '棋子大小不足以吃掉目标' };
}

function checkLocalGameOver(board) {
  let red = 0, black = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) {
        if (p.color === 'red') red++;
        else black++;
      }
    }
  }

  if (red === 0 && black === 0) return { over: true, winner: null, reason: '和局：双方均无棋子' };
  if (red === 0) return { over: true, winner: 'black', reason: '红方无棋子' };
  if (black === 0) return { over: true, winner: 'red', reason: '黑方无棋子' };
  return { over: false };
}

// ==================== 联机模式消息处理 ====================
function handlePieceFlipped(data) {
  const game = AppState.game;
  if (!game) return;

  const { row, col, piece, currentPlayer, playerColors, status } = data;

  // 更新棋盘
  game.board[row][col] = { ...piece, row, col, flipped: true };
  game.currentPlayer = currentPlayer;
  game.lastMove = data.lastMove;

  if (playerColors) {
    game.playerColors = playerColors;
    if (AppState.playerIndex >= 0) {
      AppState.myColor = playerColors[AppState.playerIndex];
    }
  }

  if (status) {
    game.status = status;
  }

  AppState.isMyTurn = currentPlayer === AppState.playerIndex;

  // 翻棋动画
  setTimeout(() => {
    const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
      const pieceEl = cell.querySelector('.piece');
      if (pieceEl) {
        pieceEl.classList.remove('back');
        pieceEl.classList.add(piece.color);
        pieceEl.textContent = piece.name;
        pieceEl.classList.add('flipping');
        setTimeout(() => pieceEl.classList.remove('flipping'), 600);
      }
    }
  }, 50);

  renderGame();
}

function handlePieceMoved(data) {
  const game = AppState.game;
  if (!game) return;

  const { from, to, piece, currentPlayer, lastMove } = data;

  game.board[to.row][to.col] = { ...piece, row: to.row, col: to.col };
  game.board[from.row][from.col] = null;
  game.currentPlayer = currentPlayer;
  game.lastMove = lastMove;
  AppState.isMyTurn = currentPlayer === AppState.playerIndex;

  renderGame();
}

function handlePieceEaten(data) {
  const game = AppState.game;
  if (!game) return;

  const { from, to, piece, eaten, currentPlayer, lastMove } = data;

  game.board[to.row][to.col] = { ...piece, row: to.row, col: to.col };
  game.board[from.row][from.col] = null;
  game.currentPlayer = currentPlayer;
  game.lastMove = lastMove;
  AppState.isMyTurn = currentPlayer === AppState.playerIndex;

  renderGame();
}

function handleBothEaten(data) {
  const game = AppState.game;
  if (!game) return;

  const { from, to, currentPlayer, lastMove } = data;

  game.board[to.row][to.col] = null;
  game.board[from.row][from.col] = null;
  game.currentPlayer = currentPlayer;
  game.lastMove = lastMove;
  AppState.isMyTurn = currentPlayer === AppState.playerIndex;

  renderGame();
}

function handleGameOver(data) {
  const game = AppState.game;
  if (game) {
    game.status = 'finished';
  }
  renderGame();

  // 观战者模式
  if (AppState.playerIndex === -1) {
    showSpectatorGameOver(data);
    return;
  }

  // 对方非正常离开时，不显示胜负判定
  if (data.reason === '对方离开') {
    document.getElementById('game-over-title').textContent = '游戏结束';
    document.getElementById('game-over-message').textContent = '对方离开';
    document.getElementById('play-again-btn').textContent = '再来一局';
    document.getElementById('back-to-lobby-btn').textContent = '返回大厅';
    document.getElementById('game-over-modal').style.display = 'flex';
    return;
  }

  let winnerText = '';
  if (data.winner === null) {
    winnerText = '和局！';
  } else if (game && game.mode === 'local') {
    winnerText = data.winner === 'red' ? '红方胜利！' : '黑方胜利！';
  } else {
    winnerText = data.winnerName === AppState.username ? '你赢了！' : '你输了！';
  }

  showGameOver(data.winner, `${winnerText} ${data.reason}`, data.winnerName);
}

function showGameOver(winner, message, winnerName = null) {
  const titleEl = document.getElementById('game-over-title');
  if (winner === null) {
    titleEl.textContent = '和局';
  } else if (AppState.game && AppState.game.mode === 'local') {
    titleEl.textContent = winner === 'red' ? '红方胜利' : '黑方胜利';
  } else {
    titleEl.textContent = winnerName === AppState.username ? '胜利' : '失败';
  }
  document.getElementById('game-over-message').textContent = message;
  document.getElementById('play-again-btn').textContent = '再来一局';
  document.getElementById('back-to-lobby-btn').textContent = '返回大厅';
  document.getElementById('game-over-modal').style.display = 'flex';
}

// ==================== 悔棋逻辑 ====================
document.getElementById('undo-btn').addEventListener('click', () => {
  if (!AppState.game || AppState.game.status === 'finished') return;

  if (AppState.game.mode === 'local') {
    // 本地模式直接悔棋
    const game = AppState.game;
    // 简单实现：本地模式不支持悔棋（或者可以通过历史回退）
    showToast('本地模式暂不支持悔棋', 'info');
    return;
  }

  if (!AppState.room) return;
  showToast('正在等待对方回应...', 'info');
  send('request_undo', { roomId: AppState.room.roomId });
});

function showUndoRequest(requester) {
  document.getElementById('undo-request-text').textContent = `${requester} 请求悔棋，是否同意？`;
  document.getElementById('undo-modal').style.display = 'flex';
}

document.getElementById('undo-accept-btn').addEventListener('click', () => {
  document.getElementById('undo-modal').style.display = 'none';
  if (AppState.room) {
    send('response_undo', { roomId: AppState.room.roomId, accept: true });
  }
});

document.getElementById('undo-reject-btn').addEventListener('click', () => {
  document.getElementById('undo-modal').style.display = 'none';
  if (AppState.room) {
    send('response_undo', { roomId: AppState.room.roomId, accept: false });
  }
});

function handleUndoAccepted(data) {
  const game = AppState.game;
  if (!game) return;

  game.board = deserializeBoard(data.board);
  game.currentPlayer = data.currentPlayer;
  game.lastMove = data.lastMove;
  AppState.isMyTurn = data.currentPlayer === AppState.playerIndex;
  AppState.selectedPiece = null;

  renderGame();
}

// ==================== 投降逻辑 ====================
document.getElementById('surrender-btn').addEventListener('click', () => {
  if (!AppState.game || AppState.game.status === 'finished') return;

  showConfirm('投降', '确定要投降吗？', () => {
    if (AppState.game.mode === 'local') {
      const game = AppState.game;
      const currentColor = game.playerColors[game.currentPlayer];
      const winner = currentColor === 'red' ? 'black' : 'red';
      game.status = 'finished';
      showGameOver(winner, '投降');
      return;
    }

    if (AppState.room) {
      send('surrender', { roomId: AppState.room.roomId });
    }
  });
});

// ==================== 游戏结束弹窗 ====================
document.getElementById('play-again-btn').addEventListener('click', () => {
  document.getElementById('game-over-modal').style.display = 'none';

  // 观战者：继续观战，等待下一局
  if (AppState.playerIndex === -1) return;

  if (AppState.game && AppState.game.mode === 'local') {
    send('local_start', {});
  } else if (AppState.room) {
    AppState.game = null;
    AppState.selectedPiece = null;
    send('play_again', { roomId: AppState.room.roomId });
  }
});

document.getElementById('back-to-lobby-btn').addEventListener('click', () => {
  document.getElementById('game-over-modal').style.display = 'none';

  // 观战者：退出观战
  if (AppState.playerIndex === -1) {
    send('leave_room', {});
    switchView('lobby-view');
    return;
  }

  if (AppState.game && AppState.game.mode === 'local') {
    AppState.game = null;
    switchView('mode-view');
  } else {
    send('leave_room', {});
    switchView('lobby-view');
  }
});

// ==================== 退出游戏 ====================
document.getElementById('game-exit-btn').addEventListener('click', () => {
  if (AppState.playerIndex === -1) {
    // 观战者直接退出，无需确认
    send('leave_room', {});
    switchView('lobby-view');
    return;
  }

  if (AppState.game && AppState.game.status !== 'finished') {
    showConfirm('退出游戏', '确定要退出当前游戏吗？', () => {
      if (AppState.game && AppState.game.mode === 'local') {
        AppState.game = null;
        switchView('mode-view');
      } else if (AppState.room) {
        send('leave_room', {});
      }
    });
    return;
  }

  if (AppState.game && AppState.game.mode === 'local') {
    AppState.game = null;
    switchView('mode-view');
  } else if (AppState.room) {
    send('leave_room', {});
  }
});

// ==================== 初始化 ====================
connectWebSocket();
