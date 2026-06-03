let messageCount = 0;
let lastMessageTime = null;
const messageLog = [];
const MAX_LOG_SIZE = 100;

export function trackMessage(nome, telefone, success) {
  messageCount++;
  lastMessageTime = new Date().toISOString();
  messageLog.unshift({
    timestamp: lastMessageTime,
    nome,
    telefone,
    success
  });
  if (messageLog.length > MAX_LOG_SIZE) {
    messageLog.pop();
  }
}

export function getStats() {
  return {
    total: messageCount,
    lastMessage: lastMessageTime
  };
}

export function getLogs() {
  return messageLog;
}
