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

  let response = await fetch(
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

  if (response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    response = await fetch(
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
    if (response.status === 429) {
      throw new Error('Rate limit exceeded');
    }
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const values = data.embedding.values;

  if (!Array.isArray(values) || values.length !== 768) {
    throw new Error(`Expected 768 dimensions but got ${values ? values.length : 0}`);
  }

  return new Float32Array(values);
}

export function embeddingToBuffer(embedding) {
  return Buffer.from(embedding.buffer);
}

export function bufferToEmbedding(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
