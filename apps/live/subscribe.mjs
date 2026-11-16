// Browser subscriber for the server change protocol. The generated service
// acks subscribe and publishes one model/op/id frame after each write; a change
// patches one row only, with a single GET for the affected record. No polling.
const OPS = new Set(['insert', 'update', 'delete']);

export function parseAck(text, model) {
  let frame;
  try { frame = JSON.parse(text); } catch { return false; }
  return frame?.type === 'subscribed' && frame.model === model;
}

export function parseChange(text, model) {
  let frame;
  try { frame = JSON.parse(text); } catch { return null; }
  if (frame?.type !== 'change' || frame.model !== model) return null;
  if (!OPS.has(frame.op) || frame.id === undefined || frame.id === null) return null;
  return frame;
}

function labels(root, token, value) {
  for (const node of root.querySelectorAll('[data-label]')) {
    const raw = node.getAttribute('data-label');
    if (raw?.includes(token)) node.textContent = raw.replace(token, value);
  }
}

export function patchRow(doc, template, id, title) {
  const key = String(id);
  const selector = `[data-for-row="${template.getAttribute('data-for-region')}"][data-for-value="${key}"]`;
  const existing = [...doc.querySelectorAll(selector)];
  if (title === null) {
    for (const row of existing) row.remove();
    return 'removed';
  }
  if (existing.length) {
    labels(existing[0], '{row}', title);
    for (const row of existing.slice(1)) row.remove();
    return 'updated';
  }
  const clone = template.content.cloneNode(true).firstElementChild;
  clone.setAttribute('data-for-row', template.getAttribute('data-for-region'));
  clone.setAttribute('data-for-item', template.getAttribute('data-item'));
  clone.setAttribute('data-for-value', key);
  labels(clone, '{row}', title);
  template.parentNode.insertBefore(clone, template.nextSibling);
  return 'inserted';
}

export function createFeed({
  model = 'Note', api = '/notes', list = 'rows', doc = globalThis.document,
} = {}) {
  const template = doc.querySelector(`template[data-for="${list}"]`);
  let socket;
  async function apply(change) {
    let title = null;
    if (change.op !== 'delete') {
      const response = await fetch(`${api}/${encodeURIComponent(change.id)}`);
      if (!response.ok) return null;
      title = (await response.json()).title;
    }
    const action = patchRow(doc, template, change.id, title);
    labels(doc, '{status}', 'live');
    labels(doc, '{lastEvent}', `${change.op} ${change.id}`);
    return action;
  }
  return {
    apply,
    open(url, Socket = globalThis.WebSocket) {
      socket = new Socket(url);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'subscribe', model }));
      });
      socket.addEventListener('message', (event) => {
        const text = typeof event.data === 'string' ? event.data : '';
        if (parseAck(text, model)) labels(doc, '{status}', 'live');
        const change = parseChange(text, model);
        if (change) void apply(change);
      });
      const offline = () => labels(doc, '{status}', 'offline');
      socket.addEventListener('close', offline);
      socket.addEventListener('error', offline);
      return socket;
    },
    close() { socket?.close(); },
  };
}

// Auto-start on a built web-dom page; query parameters pin the seam to the API.
if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  const params = new URLSearchParams(location.search);
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = params.get('ws') ?? `${scheme}://${location.host}/`;
  createFeed({
    model: params.get('model') ?? 'Note',
    api: params.get('api') ?? '/notes',
    list: params.get('list') ?? 'rows',
  }).open(url);
}
