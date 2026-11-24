#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
    echo "[ERROR] This script must be run with sudo: sudo bash $0" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
APP_DIR="/opt/mangastore-vps"
ENV_FILE="${APP_DIR}/.env"

if [ ! -f "${SOURCE_ROOT}/backend/requirements.txt" ] || [ ! -f "${SOURCE_ROOT}/frontend/package.json" ]; then
    echo "[ERROR] Missing backend/requirements.txt or frontend/package.json under ${SOURCE_ROOT}." >&2
    exit 1
fi

if [ "${SOURCE_ROOT}" != "${APP_DIR}" ]; then
    echo "[1/9] Syncing project files to ${APP_DIR}..."
    mkdir -p "${APP_DIR}"
    if [ -f "${ENV_FILE}" ]; then
        ENV_BACKUP="$(mktemp)"
        cp -p "${ENV_FILE}" "${ENV_BACKUP}"
        cp -a "${SOURCE_ROOT}/." "${APP_DIR}/"
        mv "${ENV_BACKUP}" "${ENV_FILE}"
    else
        cp -a "${SOURCE_ROOT}/." "${APP_DIR}/"
    fi
else
    echo "[1/9] Running directly from ${APP_DIR}."
fi

echo "[2/9] Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    postgresql \
    postgresql-contrib \
    nginx \
    ufw \
    curl \
    git \
    openssl \
    ca-certificates \
    gnupg

echo "[3/9] Checking Node.js version (requires >= 20 for Vite + React 19)..."
need_node=0
if ! command -v node >/dev/null 2>&1; then
    need_node=1
else
    node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [ "${node_major:-0}" -lt 20 ]; then
        need_node=1
    fi
fi

if [ "${need_node}" -eq 1 ]; then
    echo "  Installing Node.js 22 LTS from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
else
    echo "  Node.js $(node -v) satisfies requirement."
fi

echo "[4/9] Ensuring PostgreSQL binds only to localhost..."
for pg_conf in /etc/postgresql/*/main/postgresql.conf; do
    [ -f "${pg_conf}" ] || continue
    if grep -Eq '^[[:space:]]*#?[[:space:]]*listen_addresses[[:space:]]*=' "${pg_conf}"; then
        sed -i -E "s|^[[:space:]]*#?[[:space:]]*listen_addresses[[:space:]]*=.*|listen_addresses = 'localhost'|" "${pg_conf}"
    else
        echo "listen_addresses = 'localhost'" >> "${pg_conf}"
    fi
done
systemctl enable postgresql
systemctl restart postgresql

echo "[5/9] Ensuring system user 'mangastore' exists..."
if ! id -u mangastore >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home-dir "${APP_DIR}" --no-create-home mangastore
fi

run_psql() {
    (cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 "$@")
}

echo "[6/9] Configuring PostgreSQL database and ${ENV_FILE}..."
if [ -f "${ENV_FILE}" ]; then
    echo "  Preserving existing ${ENV_FILE}."
    if ! run_psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'mangastore_app'" | grep -qx '1'; then
        echo "[ERROR] ${ENV_FILE} exists, but PostgreSQL role 'mangastore_app' does not exist." >&2
        exit 1
    fi
    if ! run_psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'mangastore_db'" | grep -qx '1'; then
        run_psql -c "CREATE DATABASE mangastore_db OWNER mangastore_app;"
    fi
else
    DB_PASS="$(openssl rand -hex 24)"
    JWT_SECRET="$(openssl rand -hex 32)"

    if run_psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'mangastore_app'" | grep -qx '1'; then
        run_psql -c "ALTER ROLE mangastore_app WITH LOGIN PASSWORD '${DB_PASS}';"
    else
        run_psql -c "CREATE ROLE mangastore_app WITH LOGIN PASSWORD '${DB_PASS}';"
    fi

    if ! run_psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'mangastore_db'" | grep -qx '1'; then
        run_psql -c "CREATE DATABASE mangastore_db OWNER mangastore_app;"
    fi

    cat > "${ENV_FILE}" <<EOF
APP_ENV=production
APP_HOST=127.0.0.1
APP_PORT=8000
DATABASE_URL=postgresql+psycopg://mangastore_app:${DB_PASS}@127.0.0.1:5432/mangastore_db
JWT_SECRET=${JWT_SECRET}
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
CORS_ORIGINS=http://192.168.100.10,http://localhost
EOF
    echo "  Generated fresh ${ENV_FILE} and provisioned database credentials."
fi

run_psql -c "GRANT ALL PRIVILEGES ON DATABASE mangastore_db TO mangastore_app;"
run_psql -d mangastore_db -c "ALTER SCHEMA public OWNER TO mangastore_app; GRANT ALL ON SCHEMA public TO mangastore_app;"

echo "[7/9] Setting up Python virtualenv and building frontend..."
if [ ! -x "${APP_DIR}/backend/.venv/bin/python" ]; then
    rm -rf "${APP_DIR}/backend/.venv"
    python3 -m venv "${APP_DIR}/backend/.venv"
fi
"${APP_DIR}/backend/.venv/bin/pip" install --upgrade pip
"${APP_DIR}/backend/.venv/bin/pip" install -r "${APP_DIR}/backend/requirements.txt"

echo "  Initializing database schema and idempotent seed catalog..."
(
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
    cd "${APP_DIR}/backend"
    "${APP_DIR}/backend/.venv/bin/python" -c "import app.models; from app.database import Base, SessionLocal, get_engine; from app.seed import seed_catalog; engine = get_engine(); Base.metadata.create_all(bind=engine); db = SessionLocal(); count = seed_catalog(db); db.close(); print(f'  Seeded {count} new manga entries')"
)

cd "${APP_DIR}/frontend"
npm ci
npm run build

mkdir -p "${APP_DIR}/uploads/avatars" "${APP_DIR}/uploads/covers"
chown -R mangastore:mangastore "${APP_DIR}"
chmod 755 "${APP_DIR}" "${APP_DIR}/frontend" "${APP_DIR}/frontend/dist" "${APP_DIR}/uploads" "${APP_DIR}/uploads/avatars" "${APP_DIR}/uploads/covers"
chmod -R a+rX "${APP_DIR}/frontend/dist" "${APP_DIR}/uploads"
chmod 600 "${ENV_FILE}"

echo "[8/9] Installing systemd service and Nginx reverse proxy..."
install -m 0644 "${APP_DIR}/deploy/ubuntu/mangastore-api.service" /etc/systemd/system/mangastore-api.service
systemctl daemon-reload
systemctl enable mangastore-api.service
systemctl restart mangastore-api.service

install -m 0644 "${APP_DIR}/deploy/ubuntu/nginx-mangastore.conf" /etc/nginx/sites-available/mangastore.conf
ln -sfn /etc/nginx/sites-available/mangastore.conf /etc/nginx/sites-enabled/mangastore.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "[9/9] Configuring UFW firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow from 192.168.100.0/24 to any port 22 proto tcp
ufw allow 80/tcp
ufw --force enable

echo "[OK] MangaStore VPS deployment complete. Run 'sudo bash ${APP_DIR}/deploy/ubuntu/verify-vps.sh' to verify."
