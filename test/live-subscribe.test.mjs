import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeed, parseChange } from '../apps/live/subscribe.mjs';

class FakeLabel {
  constructor(raw) { this.raw = raw; this.textContent = ''; }
  getAttribute(name) { return name === 'data-label' ? this.raw : null; }
}

class FakeRow {
  constructor(labels) { this.attrs = {}; this.labels = labels; this.removed = false; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  querySelectorAll(selector) { return selector === '[data-label]' ? this.labels : []; }
  remove() { this.removed = true; }
}

class FakeTemplate {
  constructor(parent) {
    this.attrs = { 'data-for-region': '11', 'data-item': 'row' };
    this.parentNode = parent;
    this.nextSibling = {};
    this.content = {
      cloneNode: () => ({
        firstElementChild: new FakeRow([new FakeLabel('{row}')]),
      }),
    };
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
}

class FakeDoc {
  constructor() {
    this.status = new FakeLabel('{status}');
    this.last = new FakeLabel('last event: {lastEvent}');
    this.template = new FakeTemplate(this);
    this.rows = [];
  }
  querySelector(selector) {
    return selector === 'template[data-for="rows"]' ? this.template : null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-label]') return [this.status, this.last];
    const id = /data-for-value="([^"]+)"/.exec(selector)?.[1];
    return id === undefined ? [] : this.rows.filter((row) =>
      !row.removed && row.getAttribute('data-for-value') === id);
  }
  insertBefore(node) { this.rows.push(node); }
}

class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; this.handlers = {}; }
  addEventListener(type, handler) { (this.handlers[type] ??= []).push(handler); }
  emit(type, data) { for (const handler of this.handlers[type] ?? []) handler({ data }); }
  send(text) { this.sent.push(text); }
  close() {}
}

test('model change frames subscribe and patch only their own row', async () => {
  const realFetch = globalThis.fetch;
  const realInterval = globalThis.setInterval;
  const calls = [];
  const titles = { 7: 'first row' };
  globalThis.setInterval = () => { throw new Error('polling is not allowed'); };
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ title: titles[7] }) };
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const doc = new FakeDoc();
  try {
    assert.equal(parseChange('{oops', 'Note'), null);
    assert.equal(parseChange('{"type":"change","model":"Other","op":"insert","id":1}', 'Note'), null);

    const feed = createFeed({ doc, model: 'Note', api: '/notes', list: 'rows' });
    const socket = feed.open('ws://example.test/', FakeSocket);
    socket.emit('open');
    assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'subscribe', model: 'Note' });

    socket.emit('message', '{"type":"subscribed","model":"Note"}');
    assert.equal(doc.status.textContent, 'live');

    const change = (op, model = 'Note', id = 7) => JSON.stringify({ type: 'change', model, op, id });
    socket.emit('message', change('insert'));
    await tick();
    assert.deepEqual(calls, ['/notes/7']);
    assert.equal(doc.rows.length, 1);
    assert.equal(doc.rows[0].getAttribute('data-for-value'), '7');
    assert.equal(doc.rows[0].labels[0].textContent, 'first row');
    assert.equal(doc.last.textContent, 'last event: insert 7');

    socket.emit('message', change('insert', 'Other', 8));
    await tick();
    assert.equal(doc.rows.length, 1);
    assert.deepEqual(calls, ['/notes/7']);

    titles[7] = 'renamed row';
    socket.emit('message', change('update'));
    await tick();
    assert.equal(doc.rows.length, 1);
    assert.equal(doc.rows[0].labels[0].textContent, 'renamed row');
    assert.deepEqual(calls, ['/notes/7', '/notes/7']);

    socket.emit('message', change('delete'));
    await tick();
    assert.equal(doc.rows.length, 1);
    assert.equal(doc.rows[0].removed, true);
    assert.deepEqual(calls, ['/notes/7', '/notes/7']);
    assert.equal(doc.last.textContent, 'last event: delete 7');
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setInterval = realInterval;
  }
});
