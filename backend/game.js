// 翻翻棋游戏逻辑引擎

const PIECE_TYPES = {
  SHUAI: 'shuai',
  SHI: 'shi',
  XIANG: 'xiang',
  JU: 'ju',
  MA: 'ma',
  PAO: 'pao',
  BING: 'bing'
};

const COLORS = {
  RED: 'red',
  BLACK: 'black'
};

// 棋子大小排名（用于比较）
const RANKS = {
  [PIECE_TYPES.SHUAI]: 7,
  [PIECE_TYPES.SHI]: 6,
  [PIECE_TYPES.XIANG]: 5,
  [PIECE_TYPES.MA]: 4,
  [PIECE_TYPES.JU]: 3,
  [PIECE_TYPES.PAO]: 2,
  [PIECE_TYPES.BING]: 1
};

// 棋子中文名
const PIECE_NAMES = {
  [PIECE_TYPES.SHUAI]: { red: '帅', black: '将' },
  [PIECE_TYPES.SHI]: { red: '仕', black: '士' },
  [PIECE_TYPES.XIANG]: { red: '相', black: '象' },
  [PIECE_TYPES.JU]: { red: '車', black: '車' },
  [PIECE_TYPES.MA]: { red: '馬', black: '馬' },
  [PIECE_TYPES.PAO]: { red: '炮', black: '砲' },
  [PIECE_TYPES.BING]: { red: '兵', black: '卒' }
};

function createPiece(type, color, id) {
  return {
    id,
    type,
    color,
    flipped: false,
    name: PIECE_NAMES[type][color]
  };
}

function createInitialPieces() {
  const pieces = [];
  let id = 0;

  // 红方棋子
  pieces.push(createPiece(PIECE_TYPES.SHUAI, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.SHI, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.SHI, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.XIANG, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.XIANG, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.JU, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.JU, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.MA, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.MA, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.PAO, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.PAO, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.RED, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.RED, id++));

  // 黑方棋子
  pieces.push(createPiece(PIECE_TYPES.SHUAI, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.SHI, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.SHI, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.XIANG, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.XIANG, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.JU, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.JU, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.MA, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.MA, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.PAO, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.PAO, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.BLACK, id++));
  pieces.push(createPiece(PIECE_TYPES.BING, COLORS.BLACK, id++));

  return pieces;
}

// Fisher-Yates 洗牌算法
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createBoard() {
  const pieces = shuffle(createInitialPieces());
  const board = [];
  let pieceIndex = 0;

  for (let row = 0; row < 4; row++) {
    const rowArr = [];
    for (let col = 0; col < 8; col++) {
      const piece = pieces[pieceIndex++];
      piece.row = row;
      piece.col = col;
      rowArr.push(piece);
    }
    board.push(rowArr);
  }

  return board;
}

function cloneBoard(board) {
  return board.map(row => row.map(piece => piece ? { ...piece } : null));
}

function getPieceAt(board, row, col) {
  if (row < 0 || row >= 4 || col < 0 || col >= 8) return null;
  return board[row][col];
}

function isAdjacent(fromRow, fromCol, toRow, toCol) {
  const dr = Math.abs(toRow - fromRow);
  const dc = Math.abs(toCol - fromCol);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

function countPiecesBetween(board, fromRow, fromCol, toRow, toCol) {
  let count = 0;
  
  if (fromRow === toRow) {
    // 横向
    const minCol = Math.min(fromCol, toCol);
    const maxCol = Math.max(fromCol, toCol);
    for (let c = minCol + 1; c < maxCol; c++) {
      if (board[fromRow][c] !== null) count++;
    }
  } else if (fromCol === toCol) {
    // 纵向
    const minRow = Math.min(fromRow, toRow);
    const maxRow = Math.max(fromRow, toRow);
    for (let r = minRow + 1; r < maxRow; r++) {
      if (board[r][fromCol] !== null) count++;
    }
  }
  
  return count;
}

function isSameLine(fromRow, fromCol, toRow, toCol) {
  return fromRow === toRow || fromCol === toCol;
}

function canEat(attacker, defender) {
  if (attacker.type === PIECE_TYPES.PAO) {
    return true; // 炮隔子吃可以吃任何已翻开棋子
  }

  // 兵吃帅
  if (attacker.type === PIECE_TYPES.BING && defender.type === PIECE_TYPES.SHUAI) {
    return true;
  }

  // 帅不能吃兵
  if (attacker.type === PIECE_TYPES.SHUAI && defender.type === PIECE_TYPES.BING) {
    return false;
  }

  const attackerRank = RANKS[attacker.type];
  const defenderRank = RANKS[defender.type];

  if (attackerRank === defenderRank) {
    return 'both'; // 同归于尽
  }

  return attackerRank > defenderRank;
}

function isValidMove(board, fromRow, fromCol, toRow, toCol, playerColor) {
  // 边界检查
  if (toRow < 0 || toRow >= 4 || toCol < 0 || toCol >= 8) {
    return { valid: false, reason: '目标位置超出棋盘' };
  }

  const piece = getPieceAt(board, fromRow, fromCol);
  if (!piece) {
    return { valid: false, reason: '起始位置没有棋子' };
  }

  if (!piece.flipped) {
    return { valid: false, reason: '棋子未翻开' };
  }

  if (piece.color !== playerColor) {
    return { valid: false, reason: '不能移动对方的棋子' };
  }

  const target = getPieceAt(board, toRow, toCol);

  // 炮的特殊处理
  if (piece.type === PIECE_TYPES.PAO) {
    if (!isSameLine(fromRow, fromCol, toRow, toCol)) {
      return { valid: false, reason: '炮只能横竖移动' };
    }

    const between = countPiecesBetween(board, fromRow, fromCol, toRow, toCol);

    if (target === null) {
      // 不吃子，必须只走一格
      if (!isAdjacent(fromRow, fromCol, toRow, toCol)) {
        return { valid: false, reason: '炮不吃子时只能走一格' };
      }
      return { valid: true };
    } else if (target.flipped && target.color !== playerColor) {
      // 吃子，必须隔恰好一个棋子
      if (between !== 1) {
        return { valid: false, reason: '炮吃子必须隔恰好一个棋子' };
      }
      const eatResult = canEat(piece, target);
      if (eatResult === 'both') {
        return { valid: true, eat: 'both' };
      }
      if (eatResult) {
        return { valid: true, eat: true };
      }
      return { valid: false, reason: '无法吃掉目标棋子' };
    } else {
      return { valid: false, reason: '目标位置不能到达' };
    }
  }

  // 其他棋子
  if (!isAdjacent(fromRow, fromCol, toRow, toCol)) {
    return { valid: false, reason: '只能横竖移动一格' };
  }

  if (target === null) {
    return { valid: true };
  }

  if (!target.flipped) {
    return { valid: false, reason: '不能吃未翻开的棋子' };
  }

  if (target.color === playerColor) {
    return { valid: false, reason: '不能吃自己的棋子' };
  }

  const eatResult = canEat(piece, target);
  if (eatResult === 'both') {
    return { valid: true, eat: 'both' };
  }
  if (eatResult) {
    return { valid: true, eat: true };
  }

  return { valid: false, reason: '棋子大小不足以吃掉目标' };
}

function isValidFlip(board, row, col, playerColor) {
  if (row < 0 || row >= 4 || col < 0 || col >= 8) {
    return { valid: false, reason: '位置超出棋盘' };
  }

  const piece = getPieceAt(board, row, col);
  if (!piece) {
    return { valid: false, reason: '该位置没有棋子' };
  }

  if (piece.flipped) {
    return { valid: false, reason: '棋子已翻开' };
  }

  return { valid: true };
}

function countRemainingPieces(board, color) {
  let count = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.color === color) {
        count++;
      }
    }
  }
  return count;
}

function countPiecesByType(board, color) {
  const counts = {};
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.flipped && piece.color === color) {
        counts[piece.type] = (counts[piece.type] || 0) + 1;
      }
    }
  }
  return counts;
}

function checkGameOver(board) {
  const redCount = countRemainingPieces(board, COLORS.RED);
  const blackCount = countRemainingPieces(board, COLORS.BLACK);

  if (redCount === 0 && blackCount === 0) {
    return { over: true, winner: null, reason: '和局：双方均无棋子' };
  }

  if (redCount === 0) {
    return { over: true, winner: COLORS.BLACK, reason: '红方棋子被吃光' };
  }

  if (blackCount === 0) {
    return { over: true, winner: COLORS.RED, reason: '黑方棋子被吃光' };
  }

  return { over: false };
}

function serializeBoard(board) {
  return board.map(row =>
    row.map(piece =>
      piece
        ? {
            id: piece.id,
            type: piece.type,
            color: piece.color,
            flipped: piece.flipped,
            name: piece.name,
            row: piece.row,
            col: piece.col
          }
        : null
    )
  );
}

module.exports = {
  PIECE_TYPES,
  COLORS,
  RANKS,
  PIECE_NAMES,
  createBoard,
  cloneBoard,
  getPieceAt,
  isValidMove,
  isValidFlip,
  canEat,
  countRemainingPieces,
  countPiecesByType,
  checkGameOver,
  serializeBoard,
  shuffle
};
