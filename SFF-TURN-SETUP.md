# SFF Cloudflare TURN setup

SFF can ring using WebSocket/FCM even when WebRTC audio/video cannot cross restrictive NATs. STUN is insufficient for some networks. Configure a secure TURN relay to fix those connections.

1. Visit https://dash.cloudflare.com/ → Realtime → TURN → Create TURN key.
2. In Render SFF service → Environment add:
   - `SFF_TURN_KEY_ID`: the Cloudflare TURN key ID.
   - `SFF_TURN_API_TOKEN`: its secret API token.
3. Save to trigger a fresh Render deploy; startup logs only `turn_configured=true`.
4. Restart both SFF clients and call from different networks. SFF shows whether TURN credentials are available.

The API token stays on Render; short-lived ICE credentials are generated only when an authenticated private call joins. Existing `SFF_ICE` and community voice rooms remain unchanged. Cloudflare outage falls back to the prior STUN/ICE configuration.

**Pricing:** Cloudflare Realtime TURN/SFU share 1,000 GB free monthly egress, then $0.05/GB. Monitor usage and billing limits. No extra Turso polling or message storage occurs.

Never paste the token in chat, commit it to GitHub, or put it in the public `SFF_ICE` JSON. Render web services are not public UDP TURN servers.

Sources: https://developers.cloudflare.com/realtime/turn/generate-credentials/ and https://developers.cloudflare.com/realtime/turn/faq/
