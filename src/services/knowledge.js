import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { generateEmbedding, cosineSimilarity, embeddingToBuffer, bufferToEmbedding } from './embeddings.js';

const DB_DIR = fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'messages.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    aida_phase TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    embedding BLOB,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const stmtInsert = db.prepare(`
  INSERT INTO knowledge_chunks (category, aida_phase, content, embedding)
  VALUES (?, ?, ?, ?)
`);

const stmtDelete = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
const stmtGetAll = db.prepare('SELECT * FROM knowledge_chunks');
const stmtGetByCategory = db.prepare('SELECT * FROM knowledge_chunks WHERE category = ?');
const stmtGetByPhase = db.prepare('SELECT * FROM knowledge_chunks WHERE aida_phase = ?');

export async function addChunk(category, aidaPhase, content) {
  if (!category || typeof category !== 'string') {
    throw new Error('category must be a non-empty string');
  }
  if (!aidaPhase || typeof aidaPhase !== 'string') {
    throw new Error('aidaPhase must be a non-empty string');
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('content must be a non-empty string');
  }

  let embeddingBuffer = null;
  try {
    const embedding = await generateEmbedding(content);
    embeddingBuffer = embeddingToBuffer(embedding);
  } catch (err) {
    console.error(`[KNOWLEDGE] Embedding failed for chunk, saving without vector: ${err.message}`);
  }

  const result = stmtInsert.run(category, aidaPhase, content, embeddingBuffer);

  return {
    id: result.lastInsertRowid,
    category,
    aida_phase: aidaPhase,
    content
  };
}

export async function searchChunks(query, limit = 3) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }

  const allChunks = stmtGetAll.all();
  if (allChunks.length === 0) return [];

  try {
    const queryEmbedding = await generateEmbedding(query);

    const results = allChunks.map(chunk => {
      const chunkEmbedding = chunk.embedding
        ? bufferToEmbedding(Buffer.from(chunk.embedding))
        : null;

      if (!chunkEmbedding) {
        return { ...chunk, score: 0 };
      }

      const score = cosineSimilarity(queryEmbedding, chunkEmbedding);
      return { ...chunk, score };
    });

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  } catch (err) {
    console.error(`[KNOWLEDGE] Search failed, returning all chunks without ranking: ${err.message}`);
    return allChunks.slice(0, limit).map(c => ({ ...c, score: 0 }));
  }
}

export function deleteChunk(id) {
  if (id === undefined || id === null) {
    throw new Error('id is required');
  }
  return stmtDelete.run(id);
}

export function getAllChunks() {
  return stmtGetAll.all();
}

export function getChunksByCategory(category) {
  if (!category || typeof category !== 'string') {
    throw new Error('category must be a non-empty string');
  }
  return stmtGetByCategory.all(category);
}

export function getChunksByPhase(aidaPhase) {
  if (!aidaPhase || typeof aidaPhase !== 'string') {
    throw new Error('aidaPhase must be a non-empty string');
  }
  return stmtGetByPhase.all(aidaPhase);
}
