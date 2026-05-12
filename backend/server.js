const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { initDatabase, addUser, userExists, saveGame } = require('./db');
const { RoomManager } = require('./room');
const { isValidMove, isValidFlip, checkGameOver, serializeBoard, cloneBoard, COLORS } = require('./game');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// 提供前端静态文件
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// 在线用户
const clients = new Map(); // username -> ws
const roomManager = new RoomManager();

function send(ws, type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

function broadcastToRoom(room, type, data, excludeUsername = null) {
  const usernames = [...room.players.filter(p => p), ...room.spectators];
  for (const username of usernames) {
    if (username === excludeUsername) continue;
    const ws = clients.get(username);
    if (ws) {
      send(ws, type, data);
    }
  }
}

function getPlayerIndex(room, username) {
  if (room.players[0] === username) return 0;
  if (room.players[1] === username) return 1;
  return -1;
}

// WebSocket 连接处理
wss.on('connection', (ws) => {
  let username = null;

  ws.on('message', async (message) => {
    try {
      const { type, data } = JSON.parse(message);
      console.log(`[WS] ${type} from ${username || 'unknown'}`, data);

      switch (type) {
        case 'login': {
          const requestedUsername = data.username?.trim();
          if (!requestedUsername || requestedUsername.length < 1 || requestedUsername.length > 20) {
            send(ws, 'login_error', { message: '用户名长度需在1-20个字符之间' });
            return;
          }

          // 检查是否已在线
          if (clients.has(requestedUsername)) {
            send(ws, 'login_error', { message: '该用户名已被使用' });
            return;
          }

          username = requestedUsername;
          clients.set(username, ws);

          // 保存用户到数据库
          try {
            await addUser(username);
          } catch (e) {
            // 用户可能已存在，忽略错误
          }

          send(ws, 'login_success', { username });
          break;
        }

        case 'create_room': {
          if (!username) {
            send(ws, 'error', { message: '请先登录' });
            return;
          }

          // 如果已经在房间中，先离开
          const existingRoom = roomManager.getRoomByUser(username);
          if (existingRoom) {
            roomManager.leaveRoom(username);
            broadcastToRoom(existingRoom, 'room_update', {
              players: existingRoom.players,
              spectators: existingRoom.spectators,
              ready: existingRoom.ready,
              status: existingRoom.status
            });
          }

          const room = roomManager.createRoom(username);
          send(ws, 'room_created', {
            roomId: room.id,
            code: room.code,
            players: room.players,
            spectators: room.spectators,
            ready: room.ready,
            isPlayer: true,
            playerIndex: 0
          });
          break;
        }

        case 'join_room': {
          if (!username) {
            send(ws, 'error', { message: '请先登录' });
            return;
          }

          const { code } = data;
          const result = roomManager.joinRoom(code, username);

          if (!result.success) {
            send(ws, 'error', { message: result.error });
            return;
          }

          const room = result.room;
          const playerIndex = getPlayerIndex(room, username);

          send(ws, 'room_joined', {
            roomId: room.id,
            code: room.code,
            players: room.players,
            spectators: room.spectators,
            ready: room.ready,
            status: room.status,
            isPlayer: result.isPlayer,
            playerIndex: playerIndex >= 0 ? playerIndex : -1
          });

          // 通知房间其他人
          broadcastToRoom(room, 'room_update', {
            players: room.players,
            spectators: room.spectators,
            ready: room.ready,
            status: room.status
          }, username);
          break;
        }

        case 'ready': {
          if (!username) return;
          const { roomId } = data;
          const room = roomManager.toggleReady(roomId, username);
          if (!room) return;

          broadcastToRoom(room, 'room_update', {
            players: room.players,
            spectators: room.spectators,
            ready: room.ready,
            status: room.status
          });

          // 检查是否可以开始
          if (roomManager.canStart(roomId)) {
            const game = roomManager.startGame(roomId);
            const firstPlayerIndex = game.firstPlayer;

            // 广播抛硬币
            broadcastToRoom(room, 'coin_flip', {
              result: firstPlayerIndex,
              players: room.players
            });

            // 延迟2.5秒后发送游戏开始（等动画结束）
            setTimeout(() => {
              const room2 = roomManager.getRoomById(roomId);
              if (!room2 || !room2.game) return;

              broadcastToRoom(room2, 'game_started', {
                board: serializeBoard(room2.game.board),
                currentPlayer: room2.game.currentPlayer,
                firstPlayer: room2.game.firstPlayer,
                players: room2.players,
                status: room2.game.status
              });
            }, 2500);
          }
          break;
        }

        case 'flip': {
          if (!username) return;
          const { roomId, row, col } = data;
          const room = roomManager.getRoomById(roomId);
          if (!room || !room.game) return;

          const game = room.game;
          const playerIndex = getPlayerIndex(room, username);

          if (playerIndex === -1) {
            send(ws, 'error', { message: '你不是玩家' });
            return;
          }

          if (game.currentPlayer !== playerIndex) {
            send(ws, 'error', { message: '不是你的回合' });
            return;
          }

          // 如果是flipping阶段，必须是先手玩家
          if (game.status === 'flipping' && game.currentPlayer !== game.firstPlayer) {
            send(ws, 'error', { message: '现在不是翻棋阶段' });
            return;
          }

          const flipResult = isValidFlip(game.board, row, col);
          if (!flipResult.valid) {
            send(ws, 'error', { message: flipResult.reason });
            return;
          }

          const piece = game.board[row][col];
          piece.flipped = true;

          // 如果是flipping阶段，确定颜色绑定
          if (game.status === 'flipping') {
            game.playerColors[playerIndex] = piece.color;
            game.playerColors[1 - playerIndex] = piece.color === COLORS.RED ? COLORS.BLACK : COLORS.RED;
            game.status = 'playing';

            // 记录历史
            game.history.push({
              type: 'flip',
              row, col,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              playerIndex,
              board: serializeBoard(cloneBoard(game.board))
            });

            // 切换回合
            game.currentPlayer = 1 - game.currentPlayer;
            game.lastMove = { type: 'flip', row, col, piece };

            broadcastToRoom(room, 'piece_flipped', {
              row, col,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              playerColors: game.playerColors,
              status: game.status,
              currentPlayer: game.currentPlayer,
              lastMove: game.lastMove
            });
          } else {
            // 普通翻棋
            game.history.push({
              type: 'flip',
              row, col,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              playerIndex,
              board: serializeBoard(cloneBoard(game.board))
            });

            game.currentPlayer = 1 - game.currentPlayer;
            game.lastMove = { type: 'flip', row, col, piece };

            broadcastToRoom(room, 'piece_flipped', {
              row, col,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              currentPlayer: game.currentPlayer,
              lastMove: game.lastMove
            });
          }
          break;
        }

        case 'move': {
          if (!username) return;
          const { roomId, from, to } = data;
          const room = roomManager.getRoomById(roomId);
          if (!room || !room.game) return;

          const game = room.game;
          const playerIndex = getPlayerIndex(room, username);

          if (playerIndex === -1) {
            send(ws, 'error', { message: '你不是玩家' });
            return;
          }

          if (game.currentPlayer !== playerIndex) {
            send(ws, 'error', { message: '不是你的回合' });
            return;
          }

          if (game.status !== 'playing') {
            send(ws, 'error', { message: '游戏尚未开始' });
            return;
          }

          const playerColor = game.playerColors[playerIndex];
          const moveResult = isValidMove(game.board, from.row, from.col, to.row, to.col, playerColor);

          if (!moveResult.valid) {
            send(ws, 'error', { message: moveResult.reason });
            return;
          }

          const piece = game.board[from.row][from.col];
          const target = game.board[to.row][to.col];

          if (moveResult.eat === 'both') {
            // 同归于尽
            game.board[to.row][to.col] = null;
            game.board[from.row][from.col] = null;

            game.history.push({
              type: 'both_eaten',
              from, to,
              piece1: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              piece2: { id: target.id, type: target.type, color: target.color, name: target.name },
              playerIndex,
              board: serializeBoard(cloneBoard(game.board))
            });

            game.lastMove = { type: 'both_eaten', from, to, piece1: piece, piece2: target };

            broadcastToRoom(room, 'both_eaten', {
              from, to,
              piece1: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              piece2: { id: target.id, type: target.type, color: target.color, name: target.name },
              currentPlayer: 1 - game.currentPlayer,
              lastMove: game.lastMove
            });
          } else if (moveResult.eat) {
            // 吃子
            const eatenPiece = target;
            game.board[to.row][to.col] = piece;
            game.board[from.row][from.col] = null;
            piece.row = to.row;
            piece.col = to.col;

            game.history.push({
              type: 'eat',
              from, to,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              eaten: { id: eatenPiece.id, type: eatenPiece.type, color: eatenPiece.color, name: eatenPiece.name },
              playerIndex,
              board: serializeBoard(cloneBoard(game.board))
            });

            game.lastMove = { type: 'eat', from, to, piece, eaten: eatenPiece };

            broadcastToRoom(room, 'piece_eaten', {
              from, to,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              eaten: { id: eatenPiece.id, type: eatenPiece.type, color: eatenPiece.color, name: eatenPiece.name },
              currentPlayer: 1 - game.currentPlayer,
              lastMove: game.lastMove
            });
          } else {
            // 普通移动
            game.board[to.row][to.col] = piece;
            game.board[from.row][from.col] = null;
            piece.row = to.row;
            piece.col = to.col;

            game.history.push({
              type: 'move',
              from, to,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              playerIndex,
              board: serializeBoard(cloneBoard(game.board))
            });

            game.lastMove = { type: 'move', from, to, piece };

            broadcastToRoom(room, 'piece_moved', {
              from, to,
              piece: { id: piece.id, type: piece.type, color: piece.color, name: piece.name },
              currentPlayer: 1 - game.currentPlayer,
              lastMove: game.lastMove
            });
          }

          // 切换回合
          game.currentPlayer = 1 - game.currentPlayer;

          // 检查游戏结束
          const gameOver = checkGameOver(game.board);
          if (gameOver.over) {
            game.status = 'finished';
            game.winner = gameOver.winner;
            game.winReason = gameOver.reason;
            room.status = 'finished';

          // 保存到数据库
          const redPlayer = room.players[game.playerColors[0] === COLORS.RED ? 0 : 1];
          const blackPlayer = room.players[game.playerColors[0] === COLORS.BLACK ? 0 : 1];
          const winnerUsername = game.winner ? room.players[game.playerColors.indexOf(game.winner)] : null;
          try {
            saveGame(room.code, redPlayer, blackPlayer, winnerUsername, game.winReason, game.history);
          } catch (e) {
            console.error('保存对局失败:', e);
          }

          broadcastToRoom(room, 'game_over', {
              winner: game.winner,
              winnerName: winnerIdx >= 0 ? room.players[winnerIdx] : null,
              reason: game.winReason,
              players: room.players,
              playerColors: game.playerColors
            });
          }
          break;
        }

        case 'surrender': {
          if (!username) return;
          const { roomId } = data;
          const room = roomManager.getRoomById(roomId);
          if (!room || !room.game) return;

          const game = room.game;
          const playerIndex = getPlayerIndex(room, username);

          if (playerIndex === -1) return;
          if (game.status !== 'playing' && game.status !== 'flipping') return;

          game.status = 'finished';
          // winner 统一保存为颜色（若已绑定），否则用用户名兜底
          const opponentIndex = 1 - playerIndex;
          game.winner = game.playerColors[opponentIndex] || room.players[opponentIndex];
          game.winReason = '对方投降';
          room.status = 'finished';

          // 保存到数据库
          const redPlayer = room.players[game.playerColors[0] === COLORS.RED ? 0 : 1] || room.players[0];
          const blackPlayer = room.players[game.playerColors[0] === COLORS.BLACK ? 0 : 1] || room.players[1];
          const winnerUsername = game.playerColors[opponentIndex] ? room.players[opponentIndex] : room.players[opponentIndex];
          try {
            saveGame(room.code, redPlayer, blackPlayer, winnerUsername, game.winReason, game.history);
          } catch (e) {
            console.error('保存对局失败:', e);
          }

          broadcastToRoom(room, 'game_over', {
            winner: game.winner,
            winnerName: room.players[opponentIndex],
            reason: game.winReason,
            players: room.players,
            playerColors: game.playerColors
          });
          break;
        }

        case 'request_undo': {
          if (!username) return;
          const { roomId } = data;
          const room = roomManager.getRoomById(roomId);
          if (!room || !room.game) return;

          const game = room.game;
          const playerIndex = getPlayerIndex(room, username);

          if (playerIndex === -1) return;
          if (game.history.length === 0) {
            send(ws, 'error', { message: '没有可悔的棋' });
            return;
          }

          // 只能悔棋自己的操作
          const lastMove = game.history[game.history.length - 1];
          if (lastMove.playerIndex !== playerIndex) {
            send(ws, 'error', { message: '只能悔棋自己的操作' });
            return;
          }

          game.undoRequest = playerIndex;
          const otherPlayer = room.players[1 - playerIndex];
          const otherWs = clients.get(otherPlayer);

          if (otherWs) {
            send(otherWs, 'undo_requested', { requester: username });
          }
          break;
        }

        case 'response_undo': {
          if (!username) return;
          const { roomId, accept } = data;
          const room = roomManager.getRoomById(roomId);
          if (!room || !room.game) return;

          const game = room.game;
          const playerIndex = getPlayerIndex(room, username);

          if (playerIndex === -1) return;
          if (game.undoRequest === null || game.undoRequest === playerIndex) return;

          if (accept) {
            // 回退一步
            if (game.history.length > 0) {
              game.history.pop();
              // 恢复到上一步的棋盘状态
              if (game.history.length > 0) {
                const lastState = game.history[game.history.length - 1];
                game.board = lastState.board.map(row =>
                  row.map(p => p ? { ...p } : null)
                );
                game.currentPlayer = lastState.playerIndex;
                game.lastMove = game.history.length > 1 ? game.history[game.history.length - 2] : null;
              } else {
                // 没有任何历史了，重新初始化
                // 这种情况理论上不会发生，因为flipping的第一步也会记录
                game.currentPlayer = game.undoRequest;
                game.lastMove = null;
              }

              broadcastToRoom(room, 'undo_accepted', {
                board: serializeBoard(game.board),
                currentPlayer: game.currentPlayer,
                lastMove: game.lastMove
              });
            }
          } else {
            const requester = room.players[game.undoRequest];
            const requesterWs = clients.get(requester);
            if (requesterWs) {
              send(requesterWs, 'undo_rejected', { responder: username });
            }
          }

          game.undoRequest = null;
          break;
        }

        case 'leave_room': {
          if (!username) return;
          const room = roomManager.leaveRoom(username);
          if (room) {
            broadcastToRoom(room, 'room_update', {
              players: room.players,
              spectators: room.spectators,
              ready: room.ready,
              status: room.status
            });

            // 如果游戏因玩家离开而结束
            if (room.status === 'finished' && room.game && room.game.winner) {
              const winnerIdx2 = room.game.playerColors.indexOf(room.game.winner);
              broadcastToRoom(room, 'game_over', {
                winner: room.game.winner,
                winnerName: winnerIdx2 >= 0 ? room.players[winnerIdx2] : null,
                reason: room.game.winReason,
                players: room.players,
                playerColors: room.game.playerColors
              });
            }
          }
          send(ws, 'left_room', {});
          break;
        }

        case 'local_start': {
          if (!username) return;
          const board = require('./game').createBoard();
          const firstPlayer = Math.floor(Math.random() * 2);

          send(ws, 'local_game_started', {
            board: serializeBoard(board),
            firstPlayer,
            mode: 'local'
          });
          break;
        }

        case 'local_action': {
          if (!username) return;
          // 本地模式的前端自己维护状态，后端只提供初始棋盘
          // 这里可以扩展为本地模式也由后端计算
          break;
        }

        default:
          console.log('未知消息类型:', type);
      }
    } catch (err) {
      console.error('处理消息出错:', err);
      send(ws, 'error', { message: '服务器内部错误' });
    }
  });

  ws.on('close', () => {
    if (username) {
      const room = roomManager.leaveRoom(username);
      if (room) {
        broadcastToRoom(room, 'room_update', {
          players: room.players,
          spectators: room.spectators,
          ready: room.ready,
          status: room.status
        });

        if (room.status === 'finished' && room.game && room.game.winner) {
          broadcastToRoom(room, 'game_over', {
            winner: room.game.winner,
            reason: room.game.winReason,
            players: room.players,
            playerColors: room.game.playerColors
          });
        }
      }
      clients.delete(username);
      console.log(`用户断开连接: ${username}`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket错误:', err);
  });
});

// 启动服务器
async function start() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`翻翻棋服务器已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`WebSocket端口: ${PORT}`);
  });
}

start().catch(console.error);
