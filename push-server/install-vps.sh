#!/usr/bin/env bash
# تثبيت سيرفر إشعارات BPB OLD على الـ VPS بدون ما نلمس موقع «هدف» الموجود.
# يستخدم: bash install-vps.sh KEY_ID TEAM_ID
set -euo pipefail
KEY_ID="${1:?اكتب Key ID}"; TEAM_ID="${2:?اكتب Team ID}"
HOST="51-254-218-100.sslip.io"
SRC="$(cd "$(dirname "$0")" && pwd)"; DIR=/opt/bpb-push

command -v node >/dev/null || { echo "Node غير مثبت"; exit 1; }
sudo id bpbpush >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin bpbpush
sudo mkdir -p $DIR/api
sudo cp "$SRC/server.js" $DIR/server.js
sudo cp "$SRC/api/notify.js" $DIR/api/notify.js
if [ -f ~/bpb-apns.p8 ]; then sudo cp ~/bpb-apns.p8 $DIR/AuthKey.p8; fi
[ -f $DIR/AuthKey.p8 ] || { echo "ملف المفتاح ~/bpb-apns.p8 غير موجود"; exit 1; }
sudo chown -R bpbpush:bpbpush $DIR && sudo chmod 600 $DIR/AuthKey.p8

sudo tee /etc/systemd/system/bpb-push.service >/dev/null <<UNIT
[Unit]
Description=BPB OLD push notifications
After=network-online.target
[Service]
User=bpbpush
WorkingDirectory=$DIR
Environment=APNS_KEY_FILE=$DIR/AuthKey.p8
Environment=APNS_KEY_ID=$KEY_ID
Environment=APPLE_TEAM_ID=$TEAM_ID
Environment=PORT=8787
ExecStart=$(command -v node) $DIR/server.js
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now bpb-push
sudo systemctl restart bpb-push

# نضيف مسار /api/notify لموقعك الحالي في Caddy (نسخة احتياطية قبل التعديل)
CF=/etc/caddy/Caddyfile
if ! sudo grep -q "127.0.0.1:8787" $CF; then
  sudo cp $CF $CF.bak-bpb
  sudo python3 - "$CF" "$HOST" <<'PY'
import sys
p, host = sys.argv[1], sys.argv[2]
s = open(p).read()
i = s.index(host + ' {') + len(host + ' {')
block = "\n  handle /api/notify* {\n    reverse_proxy 127.0.0.1:8787\n  }"
open(p, 'w').write(s[:i] + block + s[i:])
PY
  if ! sudo caddy validate --config $CF --adapter caddyfile >/dev/null 2>&1; then
    echo "تعديل Caddy فيه خطأ، رجّعت النسخة القديمة"; sudo cp $CF.bak-bpb $CF; exit 1
  fi
fi
sudo systemctl reload caddy
sleep 2
echo "-----"
sudo systemctl is-active bpb-push
curl -s -X POST https://$HOST/api/notify -H 'Content-Type: application/json' -d '{}'; echo
echo "اللي فوق لازم يكون: {\"error\":\"bad request\"}"
