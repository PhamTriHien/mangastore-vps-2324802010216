#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Systemd Service Status ==="
for svc in postgresql mangastore-api nginx; do
    state="$(systemctl is-active "${svc}")"
    echo "  ${svc}: ${state}"
    if [ "${state}" != "active" ]; then
        echo "[ERROR] Service ${svc} is not active." >&2
        exit 1
    fi
done

echo ""
echo "=== 2. Listening Sockets (22, 80, 5432, 8000) ==="
ss -tulpn | grep -E ':(22|80|5432|8000)\b' || true

if ss -tln | grep -E ':(5432|8000)\b' | grep -vqE '(127\.0\.0\.1|\[::1\])'; then
    echo "[ERROR] Port 5432 or 8000 is exposed on a non-loopback address!" >&2
    exit 1
fi
echo "  [OK] Ports 5432 and 8000 are bound strictly to loopback."

echo ""
echo "=== 3. UFW Firewall Status ==="
if [ "${EUID}" -eq 0 ]; then
    ufw status verbose
else
    sudo ufw status verbose
fi

echo ""
echo "=== 4. HTTP Endpoint Smoke Checks ==="
echo "--- GET /api/health ---"
curl -fsS http://127.0.0.1/api/health
echo ""
echo "--- GET /api/products?page_size=6 ---"
curl -fsSI "http://127.0.0.1/api/products?page_size=6" | head -n 1
echo "--- GET /api/reader/sources ---"
curl -fsS http://127.0.0.1/api/reader/sources | head -c 200
echo ""
echo "--- HEAD / ---"
curl -fsSI http://127.0.0.1/

echo ""
echo "[OK] All VPS runtime, socket isolation, firewall, and HTTP checks passed."
