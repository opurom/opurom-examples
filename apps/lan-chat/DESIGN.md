# LAN Chat — Android Peer-to-Peer Encrypted Chat on OPUROM

## 1. Overview

This document defines the minimal viable product for an Android application that runs on a local
area network (LAN), establishes direct peer-to-peer connections between devices, exchanges encrypted
text messages, and keeps a local conversation history. The application is written in OPUROM, a
single-source declarative language in which one source tree defines the data model, the user
interface, and the service boundary, and the compiler lowers that source to one intermediate
representation (IR). The Android platform adapter is the only platform-specific layer.

The application is named **LanChat**. Its source lives under the `apps/lan-chat/` project:

- `apps/lan-chat/main.opu` — the entry file, holding custom components and the app tree.
- `apps/lan-chat/models/chat.opu` — the entity models (`Conversation`, `Message`, `Contact`,
  `Peer`), the service routes, and the roster data used by the screens.
- `apps/lan-chat/views/panels.opu` — the session and view state read by the screens.

The shipped skeleton is a compilable OPUROM program. It models the chat entities and presents the
chat interface (conversation list, message thread, contact entry, connection status) in declarative
OPUROM syntax. Encryption is modeled as state and data (`encrypted`, `ciphertext`, `keyId`,
`fingerprint`); the primitives that actually perform sealing and key handling are supplied by the
kernel and the Android platform adapter and are planned in this document.

## 2. Architecture

### 2.1 OPUROM model

OPUROM keeps one source of truth for types, layout and service routes. The compiler lowers that
source to a single IR document (`.opuir.json`) that carries the models, the API declarations, the
state map and the node tree. Target emitters consume the same IR and generate native source for a
target; the renderer consumes the same IR and paints a frame. The platform adapter is the only
piece that is platform-specific. The Android delivery path is the C ABI implemented by the mobile
library and surfaced to Java through JNI, with the Activity hosting the rendered frame and the
native widgets.

The LanChat design maps each application concern onto that model:

| Application concern | OPUROM representation | Delivered by |
| --- | --- | --- |
| Entity types | `model` declarations in `models/chat.opu` | Compiler, merged into IR `models` |
| Conversation, message, contact and peer data | State (`state` declarations) and model rows | State map in IR |
| Screens and controls | Node tree with `if`/`for` and components | Renderer |
| Service boundary | `api` declarations and `async` handlers | Lowered service / transport adapter |
| Socket transport, storage, permissions, notifications, crypto, background service | Capability API on the platform adapter | Android platform adapter |

### 2.2 Communication flow

The flow below describes one end-to-end message exchange. Each numbered step is assigned to the
layer that owns it.

1. **Input.** The user types into an `Input` bound to `draft`. The adapter normalizes the key event
   to an `input` event; the kernel applies the action and emits a patch that sets `draft`.
2. **Send intent.** The `Send` handler sets `connectionState = "sending"`, increments
   `sentMessages`, and clears `draft`. The actions lower to an ordered action list on the `tap`
   event, applied atomically.
3. **Payload assembly.** The message service builds a `Message` value from the current
   `Conversation`, `author`, `body` and `state`. The transport adapter serializes that value.
4. **Content encryption.** The crypto adapter seals the plaintext body with the session key bound
   to `keyId` and returns the `ciphertext`. The `Message.encrypted` flag records that the content
   was sealed before it left the device.
5. **Transport.** The socket adapter writes the sealed payload to the peer connection. The outbound
   state remains `sending` until an acknowledgement is observed.
6. **Acknowledgement.** On a peer acknowledgement the transport emits a `delivered` event and the
   message state is patched to `delivered`. On a transport failure the state is patched to `failed`
   and the retry path is entered.
7. **Inbound path.** The peer socket adapter delivers an inbound frame. The crypto adapter opens the
   payload, the message is appended to the local history, the conversation preview and unread count
   are updated, and the notification adapter posts a local notification if the conversation is not
   focused.
8. **Persistence.** After each accepted message, the storage adapter writes the `Conversation`,
   `Message`, `Contact` and `Peer` rows. On resume, the storage adapter reloads the history into
   state and the screens re-render from the same state map.
9. **Lifecycle.** On `Resumed` the adapter reconnects an established session and reloads history; on
   `Paused` the transport drains pending writes; on `Destroyed` the adapter closes the socket and
   releases the session key handle.

### 2.3 Layer responsibilities

- **Source layer.** Declares entities, state, screens and the service boundary in OPUROM syntax. No
  platform API calls appear in the source.
- **IR layer.** The compiled contract: `models`, `api`, `state`, `tree` and `theme`. It is the same
  document for every target.
- **Lowered artifacts.** The emitter output for the Android target: the renderer input, the service
  boundary, and the model migrations.
- **Platform adapter.** Hosts the IR, normalizes unified input (`Tap`, `Input`, `Key`, `Resize`,
  `Lifecycle`), presents frames, and exposes the capability API described in section 4. The adapter
  reports its capabilities through the adapter contract so the kernel can select behaviour.

## 3. MVP business code design in OPUROM

The business design is expressed in the same syntax the skeleton compiles. The entity models, the
service routes and the roster state are declared in the model module; the screens and handlers live
in the entry file.

### 3.1 Connection management

Connection management covers manual peer address and port entry, real-time connection state, and
connection history. The peer is entered on the contact screen and stored as a `Peer` row; the
connection state is a state value rendered by the status screen.

```opu
model Peer {
  id: int primary
  address: string
  port: int
  status: string
  fingerprint: string
}

api "/peers" {
  list Peer
  create Peer
}

state peerAddress = "192.168.1.20"
state peerPort = "5555"
state connected = false
state connectionState = "offline"
```

The connection screen binds the address and port inputs, and the `Connect` handler records the
intent to connect:

```opu
Button("Connect", p: 10, rounded: 10, shadow: 2, bg: "#0B57D0") {
  connectionState = "connecting"
  connected = true
}
Button("Disconnect", p: 10, rounded: 10, shadow: 2, bg: "#EEF3FC") {
  connectionState = "offline"
  connected = false
}
```

The transport adapter owns the socket lifecycle. The state value `connectionState` is the single
rendered source of truth, so the status screen and the header subtitle read the same value without
extra plumbing. Connection history is the `Peer` model persisted by the storage adapter; the
`status` field records the last observed state for each peer.

### 3.2 Messaging

Messaging covers real-time text, status indicators (`sending`, `delivered`, `failed`, `received`)
and local history persistence. The `Message` model carries the delivery state and the ciphertext.

```opu
model Message {
  id: int primary
  conversation: int
  author: string
  body: string
  state: string
  encrypted: bool = true
  ciphertext: string
}

model Conversation {
  id: int primary
  peer: string
  status: string
  preview: string
  unread: int = 0
}

api "/messages" {
  list Message
  create Message
}
```

The message thread renders each message row from the roster state. The `Send` handler applies the
transport intent and the outbound counter in one atomic action list:

```opu
Row(gap: 10, align: center, p: 8) {
  Input(bind: draft, placeholder: "message")
  Button("Send", p: 12, rounded: 12, shadow: 2, bg: "#0B57D0") {
    connectionState = "sending"
    sentMessages += 1
    draft = ""
  }
}
Text("sent {sentMessages} - received {receivedMessages}", size: 11, color: "#667085")
```

The delivery indicator is a `Badge` on each message row. The transport adapter patches the
`Message.state` value after acknowledgement or failure; the renderer reflects the patch on the next
frame.

### 3.3 Security

Security has two layers. Transport channel encryption protects the bytes on the wire. End-to-end
message content encryption protects the plaintext so that neither the transport nor an intermediary
can read it. The OPUROM layer models both as data and state; the primitives are supplied by the
platform adapter.

```opu
model Message {
  // ...
  encrypted: bool = true
  ciphertext: string
}

model Peer {
  // ...
  fingerprint: string
}

state encrypted = true
state keyVersion = 1
state sessionKeyId = "lan-chat-k1"
state fingerprint = "A1:B2:C3:D4"
```

The screens bind the encryption toggle and the key version slider, and surface the key identifier and
peer fingerprint. The crypto adapter exposes sealing, opening, key derivation and fingerprint
verification. Section 4.5 specifies the proposed native capability.

### 3.4 Contact management

Contact management covers frequent contacts and custom notes. The `Contact` model holds the display
name, the peer address used to reach the contact, and the user-editable note. The `pinned` flag
controls ordering of frequent contacts.

```opu
model Contact {
  id: int primary
  name: string
  peer: string
  note: string
  pinned: bool = false
}

api "/contacts" {
  list Contact
  create Contact
}
```

The contact screen renders the frequent peers from the roster state and offers the address and port
inputs used to add a peer:

```opu
Input(bind: peerAddress, placeholder: "peer address")
Input(bind: peerPort, placeholder: "peer port")
Button("Add peer", p: 12, rounded: 12, shadow: 2, bg: "#0B57D0") {
  connectionState = "connecting"
}
for (i in 3) {
  PeerRow("{peerLabels[i]}", "{peerAddresses[i]}", "{peerStatus[i]}")
}
```

The note field is edited on the contact entry; the storage adapter persists the row, and the list
re-renders from the reloaded state on resume.

## 4. Android native capability API proposals

The Android platform adapter extends the existing C ABI and JNI delivery path with a capability
surface. Each capability maps to an Android platform facility and to a named adapter entry point.
The proposed entry points are additive: the renderer, the kernel and the IR contract are unchanged.

### 4.1 Socket network communication

| Item | Proposal |
| --- | --- |
| Platform facility | `java.net.Socket` / `ServerSocket` over `java.nio.channels`; a non-blocking selector loop for the receive path |
| Adapter entry points | `transport.open(host, port)`, `transport.send(bytes)`, `transport.setListener(callback)`, `transport.close()` |
| Kernel interaction | Inbound frames are delivered as unified input events; outbound sends are queued while `connectionState` is `sending` |
| State effect | `connectionState` patches; inbound messages append to history state |

The adapter owns the socket, the receive loop and the reconnect schedule. The OPUROM source never
holds a socket reference; it only reads `connectionState`.

### 4.2 Local persistent storage

| Item | Proposal |
| --- | --- |
| Platform facility | `SharedPreferences` for session flags, a relational store for rows, or a key-value store for JSON documents |
| Adapter entry points | `store.save(key, json)`, `store.load(key)`, `store.query(model)`, `store.remove(key)` |
| Kernel interaction | The storage adapter reads the IR `models` to serialize rows; the full-stack lowering supplies the migration definitions |
| State effect | History is loaded into state on `Resumed`; writes follow each accepted message |

The relational path reuses the full-stack model lowering so the `models` block remains the single
type source.

### 4.3 Dynamic permission request

| Item | Proposal |
| --- | --- |
| Platform facility | `ContextCompat.checkSelfPermission` and `ActivityCompat.requestPermissions`, with a result callback |
| Adapter entry points | `permission.isGranted(name)`, `permission.request(name)` |
| Kernel interaction | The request is asynchronous; the adapter posts the result as an input event |
| State effect | A `permission` state value records the requested scope and the granted state for the status screen |

The capability request is explicit and user-driven; the adapter never requests a scope silently.

### 4.4 Notification-bar push

| Item | Proposal |
| --- | --- |
| Platform facility | `NotificationChannel` for the chat category, `NotificationManager` for posting, `PendingIntent` for the tap target |
| Adapter entry points | `notify.registerChannel(channel)`, `notify.post(channel, title, body, intentKey)` |
| Kernel interaction | Posting is triggered from the inbound receive path when the conversation is not focused |
| State effect | The notification reflects the conversation `preview` and `unread` values |

### 4.5 Encryption algorithm integration

| Item | Proposal |
| --- | --- |
| Platform facility | Platform cipher providers (`AES/GCM` or `ChaCha20-Poly1305`), a secure key store for key material, and a hash for fingerprints |
| Adapter entry points | `crypto.seal(keyId, plaintext)`, `crypto.open(keyId, ciphertext)`, `crypto.derive(peerPublic)`, `crypto.fingerprint(peerPublic)` |
| Kernel interaction | The adapter performs the transform; the OPUROM layer only stores `ciphertext`, `keyId` and `fingerprint` |
| State effect | `encrypted`, `keyVersion` and `sessionKeyId` are read by the screens; the `ciphertext` field is the sealed payload |

The channel and the content transform are separate adapter capabilities. The content transform is
applied before the transport write and after the transport read, so the plaintext never enters the
socket layer.

### 4.6 Background service persistence

| Item | Proposal |
| --- | --- |
| Platform facility | A foreground `Service` with `startForeground`, or a scheduled worker for deferred work |
| Adapter entry points | `service.start(name)`, `service.stop(name)`, `service.bind(name, callback)` |
| Kernel interaction | The service keeps the receive loop alive while the UI is not focused and flushes pending writes |
| State effect | `connectionState` stays current while the service runs; history writes are flushed on stop |

### 4.7 Capability reporting

The adapter advertises capabilities through the contract capability set. The proposed additions are
network, storage, permissions, notifications, cryptography and background service. The kernel
selects a fallback behaviour when a capability is absent, so a host without a capability still
runs with the degraded but correct behaviour of the contract.

## 5. Mobile interaction

### 5.1 Touch event adaptation

The Android adapter normalizes touch sequences to unified input. A press inside a control bounds
becomes a `Tap` event with the resolved node identifier; a press on a scroll surface becomes the
scroll gesture handled by the renderer. The adapter applies a touch slop threshold before a press is
classified as a tap, so a drag along the message thread does not trigger a row press. Native
controls provide their own pressed state, so the adapter does not re-implement press animation.

### 5.2 Soft-keyboard adaptation

When the keyboard opens, the adapter emits a `Resize` event with the reduced viewport. The message
thread reacts by scrolling to the latest message and by keeping the input row and send control
visible above the keyboard. Input focus is managed by the bound `Input` node; the `draft` state is
patched on every edit. The status and peer screens reflow at the reduced height using the same
breakpoint rules.

### 5.3 Responsive layout

Layout follows the renderer breakpoint tiers. The shell is a single column at compact width, two
columns at medium width, and a navigation rail plus content at wider widths. All dimensions are
expressed in logical pixels and scaled through the density factor reported by the adapter. The
`fontScale` theme token scales text for readability on small displays while local text sizes retain
priority. The same source tree reflows at every tier without source changes.

## 6. Framework capability coverage analysis and priority ranking

The table states what the current framework expresses in source and IR, and what the platform
adapter is planned to supply. Priority ranks the order in which the capability is delivered.

| Capability | Current OPUROM coverage | Planned adapter coverage | Priority |
| --- | --- | --- | --- |
| Entity models and service routes | `model` and `api` declarations, merged into IR | Persistence and transport consume the same models | P0 |
| Screens, state and conditional layout | Full declarative node tree, `if`/`for`, components | Renderer and input normalization | P0 |
| Conversation and message screens | Complete in the skeleton | Reads state supplied by the adapter | P0 |
| Socket transport | State and handlers only | `transport.open/send/setListener/close` | P0 |
| Local history persistence | State and model rows | `store.save/load/query/remove` | P0 |
| Dynamic permission request | None in source | `permission.isGranted/request` | P0 |
| Message delivery state | `Message.state` field | Patch on acknowledgement or failure | P0 |
| End-to-end content encryption | `ciphertext`, `keyId` data only | `crypto.seal/open/derive/fingerprint` | P1 |
| Notification-bar push | State only | `notify.registerChannel/post` | P1 |
| Background service persistence | State only | `service.start/stop/bind` | P1 |
| LAN peer discovery | Manual address entry | Discovery broadcast and rendezvous | P2 |
| Key exchange and fingerprint verification | `fingerprint` data only | `crypto.derive/fingerprint` with a key exchange | P2 |
| Multi-device reachability | State only | Presence and reachability events | P2 |

Priority ranking summary: the P0 set delivers the MVP message loop on a manually configured LAN
peer. The P1 set delivers the security and background behaviours that complete the product. The P2
set adds discovery and key exchange convenience.

## 7. Joint-debugging test plan and acceptance criteria

### 7.1 Test plan

The test plan has four layers, executed in order.

**IR and compiler layer.** Type-check and compile the project, assert a successful exit, assert the
IR carries the four models and the four routes, and assert that rendering the IR at a fixed viewport
produces the same digest on repeated runs.

**Adapter conformance layer.** Drive the adapter with scripted input events and assert the emitted
patches. Cover the connect and disconnect state transitions, the send action sequence, the
acknowledgement and failure patches, the storage load on resume, and the notification post on an
inbound message.

**Integration layer.** Run two instances on one LAN segment. Establish a connection from a manually
entered address and port, exchange messages in both directions, and assert that the sender observes
`delivered` and the receiver observes the message in the thread. Restart one instance and assert
that the history is reloaded.

**Security layer.** Capture the wire payload during a message exchange and assert that the captured
bytes carry the sealed content and not the plaintext body. Verify that opening the payload with the
wrong key fails and that the fingerprint matches the expected peer.

### 7.2 Acceptance criteria

| Acceptance criterion | Verification |
| --- | --- |
| The project type-checks and compiles to IR | `opuromc check` and `opuromc compile` exit successfully |
| The IR declares `Conversation`, `Message`, `Contact` and `Peer` | Inspect the compiled IR `models` array |
| The conversation list, message thread, contact entry and connection status render | Render the IR and assert the node tree contains the expected kinds |
| Two instances exchange a message end to end | Integration test: send on one, receive on the other |
| Delivery status reaches `delivered` on acknowledgement and `failed` on loss | Adapter test with scripted acknowledgement and loss |
| The message body is sealed before transmission | Security test over the captured payload |
| History survives a restart | Restart test: reload and assert the previous messages |
| Layout reflows across width tiers | Render at compact, medium and wide widths and assert the tree |
| Keyboard open keeps the input row visible and scrolls to the latest message | Resize-event test at a reduced viewport |
| Notification is posted for an unfocused inbound message | Adapter test on the inbound path |

## 8. Exploration points

Each exploration point lists implementation paths, compares them on performance, development cost,
framework intrusiveness and maintainability, and states a recommended option with its rationale.

### 8.1 Peer-to-peer connection establishment

**Path A — Manual direct connection.** The user enters the peer address and port; the client opens a
direct TCP connection to that peer. Discovery is manual and the connection is symmetric.

**Path B — LAN discovery plus direct connection.** The client announces itself on the LAN with a
multicast or broadcast probe, collects responding peers, and then opens the same direct connection
to the selected peer.

**Path C — Rendezvous relay.** A local relay process or a peer acting as a rendezvous point accepts
the initial handshake and forwards the connection, after which the peers talk directly.

| Criterion | Path A: manual direct | Path B: discovery plus direct | Path C: rendezvous relay |
| --- | --- | --- | --- |
| Performance | Lowest latency; one connection, no probe traffic | Adds periodic probe traffic; connection latency is otherwise equal | Extra relay hop during setup; steady-state latency equals Path A |
| Development cost | Lowest; one socket, one entry form | Moderate; probe, response parsing and peer list state | Highest; relay service, forwarding rules and lifecycle |
| Framework intrusiveness | Lowest; the transport capability is a plain socket | Low; adds a discovery capability alongside the socket | Higher; adds a relay role and a second transport surface |
| Maintainability | Simplest; one code path and one failure mode | Two code paths; discovery state is additive | Most moving parts; relay availability is a new failure domain |

**Recommended option: Path A for the MVP, Path B as the planned evolution.** Path A delivers the
complete connection flow with the least code and the least framework surface, which matches the MVP
scope. Path B is recommended next because it removes the manual entry step while keeping the same
direct connection after discovery, so the transport code is unchanged and only a discovery capability
is added.

### 8.2 End-to-end encryption implementation

**Path A — Session-key symmetric sealing.** A session key is established by an out-of-band exchange
or loaded from a key file; the content is sealed with an authenticated symmetric cipher. The peer
fingerprint is verified before the session is accepted.

**Path B — Authenticated key exchange.** The client derives a shared secret with an authenticated
key exchange, derives the session key, and verifies the peer fingerprint from the exchanged public
values. Each session gets a fresh key.

**Path C — Transport encryption only.** The channel is encrypted with the platform transport security
and the payload is sent as plaintext inside that channel.

| Criterion | Path A: session key | Path B: authenticated key exchange | Path C: transport only |
| --- | --- | --- | --- |
| Performance | Lowest per-message overhead; one symmetric seal per message | Adds a handshake cost once per session; per-message cost is equal to Path A | Lowest per-message cost; encryption is handled by the transport |
| Development cost | Low; one key handle and a seal/open pair | Moderate; key exchange, derivation and fingerprint state | Low; relies on the transport capability |
| Framework intrusiveness | Low; one crypto capability | Moderate; adds key state and a handshake flow | Low, but the content is exposed to the transport |
| Maintainability | Simple; one key lifecycle | Clear separation: handshake state and message state | Weakest guarantee; content trust depends on the channel |

**Recommended option: Path B as the target, delivered with Path A as the first milestone.** Path B
is the only path that delivers true end-to-end content protection with per-session keys and a
verifiable peer identity, which is the stated security goal. Path A is delivered first because it
exercises the full seal/open path and the ciphertext state with the least cryptographic surface, and
the key-exchange handshake is layered on the same capability without changing the message flow.

### 8.3 Chat history local storage

**Path A — Key-value store.** Each conversation and its messages are stored as one serialized document
under a key; session flags are stored alongside.

**Path B — Relational store.** The models are lowered to a relational schema; conversations, messages,
contacts and peers are stored as rows and queried by conversation.

**Path C — File-per-conversation.** One file per conversation holds the message log; contacts and
peers are stored separately.

| Criterion | Path A: key-value | Path B: relational | Path C: files |
| --- | --- | --- | --- |
| Performance | Fast for the whole-document read; slower when loading one message | Indexed reads and incremental inserts; scales with history size | Fast append; slower when many small files are scanned |
| Development cost | Low; a save/load pair per document | Moderate; schema and query definitions | Moderate; file layout and append logic |
| Framework intrusiveness | Low; a key-value capability | Moderate; reuses the full-stack model lowering | Moderate; a file capability and directory layout |
| Maintainability | Simple for a small history; whole-document rewrites grow with size | Strongest for growth; queries stay explicit | File count and cleanup rules add operating burden |

**Recommended option: Path B, staged with Path A as the first milestone.** Path B aligns the storage
schema with the model declarations, so the same `models` block drives the schema and the queries and
the storage layer stays consistent as entities evolve. Path A is delivered first because it requires
the least infrastructure and proves the persistence and resume flow, and the migration to Path B
reuses the model lowering rather than a new data shape.

## 9. Capability split

### 9.1 Implementable with the current framework today

The following are expressed entirely in OPUROM and compile in the shipped skeleton:

- The entity models `Conversation`, `Message`, `Contact` and `Peer`, with their service routes.
- The conversation list screen, the message thread screen, the contact entry screen and the
  connection status screen.
- The connection, message, security and contact state models, including the encryption data fields
  (`encrypted`, `ciphertext`, `keyId`, `fingerprint`).
- The responsive shell, the conditional view switching, the roster rendering and the theme.
- The single-source type and route contract, lowered to one IR document.

### 9.2 Requires a pending framework capability

The following require a platform adapter capability that is planned but not part of the compiled
skeleton:

- The socket transport primitive (`transport.open/send/setListener/close`).
- The local persistent storage primitive (`store.save/load/query/remove`).
- The dynamic permission request primitive (`permission.isGranted/request`).
- The notification-bar primitive (`notify.registerChannel/post`).
- The encryption primitive (`crypto.seal/open/derive/fingerprint`) and the secure key store binding.
- The background service primitive (`service.start/stop/bind`).
- The LAN peer discovery primitive.

The OPUROM source declares the state and data each capability consumes, so adding the capability
completes the loop without changing the screens or the models.

## 10. Roadmap

The roadmap states the sequence in which the planned capabilities are delivered.

- **Milestone 1 — Connected shell.** Deliver the socket transport, the manual peer entry, the
  connection state rendering, and the delivery status indicators. Persist the conversation and
  message rows with the key-value store so the MVP message loop is complete.
- **Milestone 2 — Secure messaging.** Deliver the encryption primitive with the session-key path,
  apply sealing on the outbound path and opening on the inbound path, and verify the peer
  fingerprint. Add the notification primitive.
- **Milestone 3 — Background and discovery.** Deliver the background service for receive-path
  persistence, and add LAN peer discovery to replace manual address entry.
- **Milestone 4 — Key exchange.** Deliver the authenticated key exchange and per-session keys, and
  layer fingerprint verification on the exchanged public values.
