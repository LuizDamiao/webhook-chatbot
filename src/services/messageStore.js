import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'messages.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    body TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'outgoing',
    status TEXT NOT NULL DEFAULT 'sent',
    type TEXT NOT NULL DEFAULT 'text',
    customer_name TEXT DEFAULT '',
    quoted_text TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    message_id TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_user);
  CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_user);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`);

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO messages (id, from_user, to_user, body, timestamp, direction, status, type, customer_name, quoted_text, file_name, message_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetAll = db.prepare('SELECT * FROM messages ORDER BY timestamp ASC');
const stmtGetRecent = db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?');
const stmtGetByPhone = db.prepare('SELECT * FROM messages WHERE from_user = ? OR to_user = ? ORDER BY timestamp ASC');
const stmtCount = db.prepare('SELECT COUNT(*) as count FROM messages');
const stmtUpdateStatus = db.prepare('UPDATE messages SET status = ? WHERE id = ?');

function rowToMsg(row) {
  return {
    id: row.id,
    from: row.from_user,
    to: row.to_user,
    body: row.body,
    timestamp: row.timestamp,
    direction: row.direction,
    status: row.status,
    type: row.type,
    customerName: row.customer_name,
    quotedText: row.quoted_text || null,
    fileName: row.file_name || null,
    messageId: row.message_id || null
  };
}

export const messageStore = {
  add(msg) {
    const id = msg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const message = {
      id,
      from: msg.from,
      to: msg.to,
      body: msg.body,
      timestamp: msg.timestamp || new Date().toISOString(),
      direction: msg.direction || 'outgoing',
      status: msg.status || 'sent',
      type: msg.type || 'text',
      customerName: msg.customerName || '',
      quotedText: msg.quotedText || null,
      fileName: msg.fileName || null,
      messageId: msg.messageId || null
    };

    stmtInsert.run(
      message.id, message.from, message.to, message.body,
      message.timestamp, message.direction, message.status, message.type,
      message.customerName, message.quotedText || '', message.fileName || '', message.messageId || ''
    );

    return message;
  },

  getAll() {
    return stmtGetAll.all().map(rowToMsg);
  },

  getRecent(count = 50) {
    return stmtGetRecent.all(count).reverse().map(rowToMsg);
  },

  getByPhone(phone) {
    return stmtGetByPhone.all(phone, phone).map(rowToMsg);
  },

  updateStatus(id, status) {
    stmtUpdateStatus.run(status, id);
  },

  clear() {
    db.exec('DELETE FROM messages');
  },

  get count() {
    return stmtCount.get().count;
  },

  get messages() {
    return this.getAll();
  }
};
