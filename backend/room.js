// 房间管理系统

const { createBoard, cloneBoard, serializeBoard, checkGameOver, isValidMove, isValidFlip, countPiecesByType } = require('./game');

const ROOM_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟清理一次空房间
const ROOM_MAX_IDLE = 10 * 60 * 1000; // 房间最大空闲10分钟

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> room
    this.userRooms = new Map(); // username -> roomId
    this.nextRoomId = 1;
    this.disconnectTimers = new Map(); // username -> timeoutId

    // 定期清理僵尸房间
    setInterval(() => this.cleanupRooms(), ROOM_CLEANUP_INTERVAL);
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    // 检查是否重复
    for (const room of this.rooms.values()) {
      if (room.code === code) {
        return this.generateCode();
      }
    }
    return code;
  }

  createRoom(creator) {
    // 如果用户之前有未超时的离线记录，取消它
    this.cancelOffline(creator);

    const roomId = `room_${this.nextRoomId++}`;
    const code = this.generateCode();
    
    const room = {
      id: roomId,
      code,
      players: [creator, null], // 创建者默认占第一个位置
      spectators: [],
      ready: [false, false],
      game: null,
      status: 'waiting',
      creator: creator,
      createdAt: Date.now()
    };

    this.rooms.set(roomId, room);
    this.userRooms.set(creator, roomId);

    return room;
  }

  joinRoom(code, username) {
    const room = Array.from(this.rooms.values()).find(r => r.code === code);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    if (room.status !== 'waiting') {
      return { success: false, error: '房间已开始游戏或已结束' };
    }

    // 检查是否已在房间中（可能是断线重连）
    if (room.players[0] === username || room.players[1] === username) {
      // 取消离线定时器（如果是重连）
      this.cancelOffline(username);
      return { success: true, room, isPlayer: true };
    }
    if (room.spectators.includes(username)) {
      return { success: true, room, isPlayer: false };
    }

    // 尝试加入玩家位（优先填补空位）
    if (room.players[0] === null) {
      room.players[0] = username;
      this.userRooms.set(username, room.id);
      return { success: true, room, isPlayer: true };
    }
    if (room.players[1] === null) {
      room.players[1] = username;
      this.userRooms.set(username, room.id);
      return { success: true, room, isPlayer: true };
    }

    // 作为观战者加入
    room.spectators.push(username);
    this.userRooms.set(username, room.id);
    return { success: true, room, isPlayer: false };
  }

  leaveRoom(username) {
    const roomId = this.userRooms.get(username);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    // 从玩家中移除
    if (room.players[0] === username) {
      room.players[0] = null;
    } else if (room.players[1] === username) {
      room.players[1] = null;
    } else {
      // 从观战者中移除
      const idx = room.spectators.indexOf(username);
      if (idx !== -1) {
        room.spectators.splice(idx, 1);
      }
    }

    this.userRooms.delete(username);

    // waiting 状态：即使房间空了也不删除，保留一段时间让其他人加入或创建者回来
    // playing/finished 状态：如果空了则删除
    if (room.status !== 'waiting') {
      if (!room.players[0] && !room.players[1] && room.spectators.length === 0) {
        this.rooms.delete(roomId);
        return null;
      }

      // 如果游戏正在进行且玩家离开，游戏结束
      if (room.status === 'playing' && room.game) {
        const otherPlayer = room.players[0] || room.players[1];
        if (otherPlayer) {
          room.game.status = 'finished';
          const otherIndex = room.players[0] ? 0 : 1;
          room.game.winner = room.game.playerColors[otherIndex];
          room.game.winReason = '对方离开';
          room.status = 'finished';
        }
      }
    }

    return room;
  }

  // 标记用户离线（waiting状态延迟移除）
  markOffline(username) {
    const roomId = this.userRooms.get(username);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    // 游戏中立即处理（不能延迟，否则另一个玩家会卡住）
    if (room.status === 'playing') {
      return this.leaveRoom(username);
    }

    // waiting状态：延迟10分钟从房间中移除
    // 如果用户在这10分钟内重连，调用 cancelOffline 取消
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(username);
      this.leaveRoom(username);
    }, 10 * 60 * 1000);

    this.disconnectTimers.set(username, timer);
    return room;
  }

  // 取消离线定时器（用户重连时调用）
  cancelOffline(username) {
    const timer = this.disconnectTimers.get(username);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(username);
      return true;
    }
    return false;
  }

  // 定期清理长时间空闲的waiting房间
  cleanupRooms() {
    const now = Date.now();
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.status === 'waiting' && (now - room.createdAt > ROOM_MAX_IDLE)) {
        // 清理该房间下所有用户的 userRooms 映射
        for (const [user, id] of this.userRooms.entries()) {
          if (id === roomId) {
            this.userRooms.delete(user);
            this.disconnectTimers.delete(user);
          }
        }
        this.rooms.delete(roomId);
        console.log(`清理空闲房间: ${roomId}`);
      }
    }
  }

  toggleReady(roomId, username) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    let playerIndex = -1;
    if (room.players[0] === username) playerIndex = 0;
    else if (room.players[1] === username) playerIndex = 1;

    if (playerIndex === -1) return null;

    room.ready[playerIndex] = !room.ready[playerIndex];
    return room;
  }

  canStart(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.players[0] && room.players[1] && room.ready[0] && room.ready[1];
  }

  startGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const board = createBoard();
    const firstPlayer = Math.floor(Math.random() * 2); // 0 或 1

    room.game = {
      board,
      currentPlayer: firstPlayer, // 当前轮到谁
      firstPlayer: firstPlayer,   // 谁先手
      playerColors: [null, null], // 玩家0和玩家1的颜色
      history: [],
      status: 'flipping', // flipping -> playing -> finished
      winner: null,
      winReason: null,
      lastMove: null,
      undoRequest: null
    };

    room.status = 'playing';
    return room.game;
  }

  getRoomById(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomByCode(code) {
    return Array.from(this.rooms.values()).find(r => r.code === code);
  }

  getRoomByUser(username) {
    const roomId = this.userRooms.get(username);
    if (!roomId) return null;
    return this.rooms.get(roomId);
  }
}

module.exports = { RoomManager };
