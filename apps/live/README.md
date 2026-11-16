# Live feed

One model (`Note`), one CRUD API and one route page. `subscribe.mjs` opens a
WebSocket, sends `{"type":"subscribe","model":"Note"}`, and applies each
`{"type":"change","model":"Note","op":...,"id":...}` frame to one DOM row.
There is no polling: an insert or update fetches only the changed record, a
delete removes the row by id.

## Run

```sh
cd /Users/mac/work/opurom
node opurom-cli/bin/opurom.mjs build --src opurom-examples/apps/live/live.opu --target full --out /tmp/live-full
node opurom-cli/bin/opurom.mjs build --src opurom-examples/apps/live/live.opu --target web-dom --out /tmp/live-web
cp opurom-examples/apps/live/subscribe.mjs /tmp/live-web/
python3 - <<'PY'
p = '/tmp/live-web/index.html'
s = open(p).read().replace('</body>', '<script type="module" src="subscribe.mjs"></script></body>')
open(p, 'w').write(s)
PY
OPR_WEBSOCKET=1 node opurom-cli/bin/opurom.mjs serve --out /tmp/live-full --port 8787 &
python3 -m http.server 8080 --directory /tmp/live-web
```

Open `http://127.0.0.1:8080/?ws=ws://127.0.0.1:8787/`; the status pill turns
`live`. Writes from any client now publish one change frame automatically:

```sh
curl -s -X POST http://127.0.0.1:8787/notes \
  -H 'Content-Type: application/json' -d '{"title":"incoming row"}'
curl -s -X PUT http://127.0.0.1:8787/notes/1 \
  -H 'Content-Type: application/json' -d '{"id":1,"title":"renamed row","done":false}'
curl -s -X DELETE http://127.0.0.1:8787/notes/1
```

Each write patches only its own row without a reload. The page ignores frames
for other models and keeps the socket open until it closes.

## Protocol

The generated service owns the wire contract: subscribe control and ack carry
`model`; a successful create, update or delete publishes one `change` frame in
write order. The client has no polling loop and no custom bridge.
