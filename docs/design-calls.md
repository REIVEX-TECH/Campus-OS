# Design note: voice/video calls (out of scope, for later)

Calls are **not** being built now. This one-pager records how they would fit, so
the messages work does not paint us into a corner.

## Shape

- **1:1 only**, initiated from an existing direct-message conversation (the
  `messages` module is the home; a call is a mode of a conversation, not a new
  social graph).
- **WebRTC** peer-to-peer media. The browser's `RTCPeerConnection` carries audio
  and video directly between the two participants; the server never sees media.

## What the server must provide

1. **Signaling** — a channel to exchange SDP offers/answers and ICE candidates
   between the two peers. The platform already chose **polling over websockets**
   for messages (§2, no realtime-infra dependency); signaling is more latency
   sensitive, but a short-lived poll (or SSE, if we accept it) against a
   `call_signals` table scoped to the conversation is enough to set a call up. No
   media flows through it — only a few small SDP/ICE payloads during negotiation.
2. **STUN** — free/public STUN servers (e.g. Google's) let most peers discover
   their public address. No cost, no hosting.
3. **TURN** — a relay for the ~10–20% of peers behind symmetric NATs that STUN
   cannot traverse. **This is the only piece with a real cost/operational weight**:
   TURN relays media, so it needs bandwidth. Options that fit §2 (no paid tier
   required): self-host **coturn** (open source) on the existing VM, with the
   free-tier caveat that relayed calls consume that VM's bandwidth; document the
   self-hosted fallback and make the TURN URL/credentials config, behind the
   existing service seam, never hardcoded.

## Privacy / safety

- Media is peer-to-peer (not stored, not server-visible). A call leaves only
  metadata: who called whom and when, in the conversation's own audit/notification
  trail — the same minimal footprint as a message, no content.
- Blocks and the `whoCanMessage` setting gate a call exactly as they gate a
  message (you cannot call someone you cannot message).
- No recording. If recording is ever wanted, it is a separate, consent-gated
  feature with its own threat model.

## Why deferred

TURN is the only hard dependency, and it is an operational (bandwidth) cost, not a
code problem. Until there is demand, the messaging thread carries the value; calls
are a later addition that reuses the same conversation, blocks, and settings.
