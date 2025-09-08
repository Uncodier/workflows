## Email Validation Worker (systemd) - Operations Guide

### Overview
- This worker validates emails via DNS/MX and SMTP (RCPT TO), and now, in basic fallback validation, probes up to 3 MX hosts to reduce false negatives when a single MX tarpits or throttles.
- Deliverability is true when SMTP accepts RCPT TO and domain bounce risk is not high. Catchall acceptance returns result "catchall" but remains deliverable.

### Service details
- Service name: `uncodie-email-validation-worker.service`
- Typical repo path on VM: adjust to your installation, e.g. `/srv/Workflows`.

### Update code on the VM
```bash
ssh <user>@<worker-ip>
cd /path/to/Workflows
git fetch origin
git switch main && git pull --rebase --autostash origin main
npm ci
npm run build
```

### Configure environment (timeouts, EHLO, MAIL FROM)
Use a systemd override to persist environment variables.
```bash
sudo mkdir -p /etc/systemd/system/uncodie-email-validation-worker.service.d
sudo tee /etc/systemd/system/uncodie-email-validation-worker.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment=EMAIL_VALIDATOR_CONNECT_TIMEOUT_MS=25000
Environment=EMAIL_VALIDATOR_EHLO_DOMAIN=validator.uncodie.com
Environment=EMAIL_VALIDATOR_MAIL_FROM=validate@uncodie.com
EOF

sudo systemctl daemon-reload
sudo systemctl restart uncodie-email-validation-worker.service
```

Notes:
- `EMAIL_VALIDATOR_CONNECT_TIMEOUT_MS` controls TCP connect timeout to MX:25. 20000–30000ms is reasonable for large providers.
- Use your own EHLO domain and a MAIL FROM that matches your domain.

### Restart, status and logs
```bash
sudo systemctl restart uncodie-email-validation-worker.service
sudo systemctl status uncodie-email-validation-worker.service --no-pager
journalctl -u uncodie-email-validation-worker.service -n 200 --no-pager
journalctl -u uncodie-email-validation-worker.service -f
```

### Quick SMTP connectivity tests (no sudo)
Test TCP:25 to each MX of your domain:
```bash
for host in $(dig +short MX uncodie.com | sort -n | awk '{print $2}' | sed 's/\.$//'); do
  printf -- "-- Testing %s:25 ... " "$host"
  if nc -vz -w 15 "$host" 25 >/dev/null 2>&1; then
    echo "OK"
  else
    echo "FAIL (timeout/blocked)"
  fi
done
```

Check SMTP banner and issue EHLO/MAIL FROM/RCPT TO (does not send mail):
```bash
host=$(dig +short MX uncodie.com | sort -n | awk '{print $2}' | sed 's/\.$//' | head -1)
from="validate@uncodie.com"
to="ale@uncodie.com"
{
  printf "EHLO validator.uncodie.com\r\n"
  printf "MAIL FROM:<%s>\r\n" "$from"
  printf "RCPT TO:<%s>\r\n" "$to"
  printf "QUIT\r\n"
} | nc -v -w 20 "$host" 25
```

Interpretation:
- RCPT returns `250` → technically deliverable.
- `550 5.1.1` → user unknown.
- `4xx` or policy/blocked wording → inconclusive or blocked; may require higher timeout or different MX.

### Troubleshooting tips
- If some Google MX hosts fail but others succeed, this is expected (tarpit/rotation). The basic validation now tries up to 3 MX, reducing false negatives.
- Ensure the worker host has outbound port 25 open and proper DNS/PTR; large providers may rate-limit by IP reputation.
- If running in a serverless environment (e.g., Vercel), SMTP:25 is often blocked; run validations from this VM worker instead.


