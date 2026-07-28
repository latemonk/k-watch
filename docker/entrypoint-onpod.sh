#!/bin/sh
# KCG onpod all-in-one entrypoint: generates loopback-only secrets when not
# provided, wires the four internal services together, then hands off to
# supervisord (redis → redis-rest → ais-relay → api sidecar → nginx).
set -e

# Docker secrets → env var bridge (kept from upstream entrypoint)
if [ -d /run/secrets ]; then
  for secret_file in /run/secrets/*; do
    [ -f "$secret_file" ] || continue
    key=$(basename "$secret_file")
    value=$(cat "$secret_file" | tr -d '\n')
    export "$key"="$value"
  done
fi

gen() { node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"; }

export REDIS_PASSWORD="${REDIS_PASSWORD:-$(gen)}"
export REDIS_TOKEN="${REDIS_TOKEN:-$(gen)}"
export RELAY_SHARED_SECRET="${RELAY_SHARED_SECRET:-$(gen)}"
# Browser RPC auth: the SPA mints an anonymous HMAC session via
# /api/wm-session, signed with this secret. Without it every RPC 401s and
# the vessel layer stays empty. Auto-generated per boot when not pinned via
# --env (pin it if you ever run more than one replica).
export WM_SESSION_SECRET="${WM_SESSION_SECRET:-$(gen)}"

# Intra-container wiring (loopback only)
export SRH_TOKEN="$REDIS_TOKEN"
export SRH_CONNECTION_STRING="redis://:${REDIS_PASSWORD}@127.0.0.1:6379"
export UPSTASH_REDIS_REST_URL="http://127.0.0.1:8079"
export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"
export UPSTASH_ALLOW_INSECURE_HTTP="true"
export WS_RELAY_URL="http://127.0.0.1:3004"
export RELAY_AUTH_HEADER="${RELAY_AUTH_HEADER:-x-relay-key}"
export LOCAL_API_MODE="${LOCAL_API_MODE:-docker}"
export LOCAL_API_CLOUD_FALLBACK="${LOCAL_API_CLOUD_FALLBACK:-false}"

# News digest budget. The defaults in list-feed-digest.ts are derived from
# Vercel Edge's 25s initial-response ceiling, which does not exist here: nginx
# fronts the API with proxy_read_timeout 120s. On this container's CPU a cold
# ~100-feed build overruns the 14s default and gets force-rejected, so the
# digest returned an empty payload on every cold miss and all news panels went
# blank. These values leave the whole request comfortably inside nginx's 120s
# (and the edge gateway's 95s) while giving a cold build room to finish; once
# built, the 900s Redis cache serves everyone else.
export NEWS_DIGEST_RESPONSE_TIMEOUT_MS="${NEWS_DIGEST_RESPONSE_TIMEOUT_MS:-55000}"
export NEWS_DIGEST_DEADLINE_MS="${NEWS_DIGEST_DEADLINE_MS:-40000}"

export LOCAL_API_PORT="${LOCAL_API_PORT:-46123}"
if [ -z "${LOCAL_API_TOKEN:-}" ]; then
  LOCAL_API_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
  export LOCAL_API_TOKEN
fi

envsubst '$LOCAL_API_PORT $LOCAL_API_TOKEN' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/worldmonitor.conf
