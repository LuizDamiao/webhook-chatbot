const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

export function cosineSimilarity(a, b) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function generateEmbedding(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text must be a non-empty string');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const response = await fetch(
    `${API_URL}?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return new Float32Array(data.embedding.values);
}

export function embeddingToBuffer(embedding) {
  return Buffer.from(embedding.buffer);
}

export function bufferToEmbedding(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
