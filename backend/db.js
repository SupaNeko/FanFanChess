const fs = require('fs');
const path = require('path');

let SQL;
let db;

const DB_PATH = path.join(__dirname, 'fanfan_chess.db');

async function initDatabase() {
  SQL = await require('sql.js')();
  
  // 尝试从文件加载
  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(filebuffer);
    console.log('数据库从文件加载成功');
  } else {
    db = new SQL.Database();
    console.log('新数据库已创建');
  }
  
  createTables();
  saveDatabase();
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      red_player TEXT NOT NULL,
      black_player TEXT NOT NULL,
      winner TEXT,
      win_reason TEXT,
      moves TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  console.log('数据表初始化完成');
}

function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function addUser(username) {
  try {
    db.run('INSERT OR IGNORE INTO users (username) VALUES (?)', [username]);
    saveDatabase();
    return { username };
  } catch (e) {
    throw e;
  }
}

function userExists(username) {
  const result = db.exec('SELECT 1 FROM users WHERE username = ?', [username]);
  return result.length > 0 && result[0].values.length > 0;
}

function saveGame(roomCode, redPlayer, blackPlayer, winner, winReason, moves) {
  try {
    db.run(
      'INSERT INTO games (room_code, red_player, black_player, winner, win_reason, moves) VALUES (?, ?, ?, ?, ?, ?)',
      [roomCode, redPlayer, blackPlayer, winner, winReason, JSON.stringify(moves)]
    );
    saveDatabase();
    return { success: true };
  } catch (e) {
    console.error('保存对局失败:', e);
    throw e;
  }
}

function getUserGames(username) {
  const result = db.exec(
    'SELECT * FROM games WHERE red_player = ? OR black_player = ? ORDER BY created_at DESC',
    [username, username]
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

module.exports = {
  initDatabase,
  addUser,
  userExists,
  saveGame,
  getUserGames
};
