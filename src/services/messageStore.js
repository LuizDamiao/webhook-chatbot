const messages = [];
const MAX_MESSAGES = 1000;

export const messageStore = {
  add(msg) {
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      from: msg.from,
      to: msg.to,
      body: msg.body,
      timestamp: msg.timestamp || new Date().toISOString(),
      direction: msg.direction || 'outgoing',
      status: msg.status || 'sent',
      type: msg.type || 'text',
      ...msg
    };

    messages.push(message);

    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }

    return message;
  },

  getAll() {
    return [...messages];
  },

  getRecent(count = 50) {
    return messages.slice(-count);
  },

  getByPhone(phone) {
    return messages.filter(m =>
      m.from === phone || m.to === phone
    );
  },

  updateStatus(id, status) {
    const msg = messages.find(m => m.id === id);
    if (msg) {
      msg.status = status;
      return msg;
    }
    return null;
  },

  clear() {
    messages.length = 0;
  },

  get count() {
    return messages.length;
  }
};
