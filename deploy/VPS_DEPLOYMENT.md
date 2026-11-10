# Deploying Shayvera on a VPS (single server)

One Ubuntu server runs everything with Docker: PostgreSQL, the website, the background worker, and Caddy
in front for HTTPS. The stack (`docker-compose.prod.yml` + `Dockerfile`) was built and smoke-tested with
Docker: migrations, seed, admin creation, admin sign-in, image upload, product images, and data surviving a
container restart. The domain and HTTPS steps (Caddy, DNS) could not be tested without a real server.

## 0. What you need

| Item          | Recommendation                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS           | **2 vCPU, 4 GB RAM, 40 GB+ SSD**, Ubuntu 24.04 LTS, in an Indian region (Mumbai/Bangalore) — e.g. DigitalOcean, Hetzner, AWS Lightsail, Hostinger VPS. 2 GB works with the swap file in step 2, but builds are slow. |
| Domain        | e.g. `shayvera.in` — you need access to its DNS settings                                                                                                                                                             |
| Email sending | An SMTP service (Amazon SES, Brevo, Zoho ZeptoMail, …) for order emails and password resets                                                                                                                          |
| Payments      | Razorpay keys (test keys first, live keys after KYC)                                                                                                                                                                 |
| Optional      | MSG91 for OTP sign-in, Shiprocket for shipping                                                                                                                                                                       |

At idle the app uses about 250 MB of RAM (web ≈ 120 MB, worker ≈ 90 MB, database ≈ 45 MB); building the
images needs 2–3 GB.

## 1. Point the domain at the server

At your domain registrar's DNS settings, add:

| Type | Name  | Value               |
| ---- | ----- | ------------------- |
| A    | `@`   | your VPS IP address |
| A    | `www` | your VPS IP address |

DNS can take from a few minutes to a few hours. Check with `ping shayvera.in`.

## 2. First login and basic security

From your PC (PowerShell): `ssh root@YOUR_SERVER_IP`

```bash
# Updates
apt update && apt upgrade -y

# A normal user for day-to-day work (replace "shayvera" if you like)
adduser shayvera
usermod -aG sudo shayvera
rsync --archive --chown=shayvera:shayvera ~/.ssh /home/shayvera   # only if you log in with an SSH key

# Firewall: SSH + web only
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# Swap (needed on 2 GB servers, harmless on bigger ones)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Log out and back in as the new user: `ssh shayvera@YOUR_SERVER_IP`

## 3. Install Docker

Official instructions: <https://docs.docker.com/engine/install/ubuntu/>

```bash
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in, then check: `docker run --rm hello-world`

## 4. Get the code onto the server

The repository is private, so give the server a read-only **deploy key**:

```bash
ssh-keygen -t ed25519 -C "shayvera-vps" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy the printed line → GitHub → repository → **Settings → Deploy keys → Add deploy key** (leave
"Allow write access" off). Then:

```bash
git clone -b claude/festive-franklin-tg5y03 git@github.com:sayedmajidali/shayvera-ecommerce.git ~/shayvera
cd ~/shayvera
```

(If you later merge the work into `main`, clone/pull `main` instead.)

## 5. Production settings (`.env.production`)

```bash
cp .env.example .env.production
chmod 600 .env.production
nano .env.production
```

Change these (everything else can stay as in the example):

```ini
NEXT_PUBLIC_APP_URL="https://shayvera.in"
BETTER_AUTH_URL="https://shayvera.in"

# Strong, unique values. Generate each with:  openssl rand -base64 32
POSTGRES_PASSWORD="<random>"           # letters/numbers only is safest (it goes into a URL)
BETTER_AUTH_SECRET="<random>"

# DATABASE_URL is set by docker-compose.prod.yml — you do not need to edit it here.

# Payments (start with test keys; COD works without them)
PAYMENT_GATEWAY="razorpay"
RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_SECRET="..."
RAZORPAY_WEBHOOK_SECRET="..."          # you choose this in step 9

# Email — required for real customers (order emails, password reset)
EMAIL_PROVIDER="smtp"
SMTP_URL="smtps://USER:PASSWORD@smtp.example.com:465"
EMAIL_FROM="Shayvera Food <orders@shayvera.in>"

# Uploaded images live in a Docker volume on this server
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="./storage/uploads"

# OTP sign-in: phone sign-in stays OFF until MSG91 is configured
SMS_PROVIDER="dev-outbox"              # change to "msg91" + MSG91_* values when ready

# Caddy is the only proxy in front of the app
TRUSTED_PROXY_HOPS="1"
```

Notes:

- Use `openssl rand -hex 32` for `POSTGRES_PASSWORD` to avoid characters like `@` or `/`.
- Never commit this file (it is already git-ignored) and never paste it into chats.
- `PAYMENT_GATEWAY="mock"` is refused in production.

## 6. Build and start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The first build takes 5–15 minutes. Then check:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl -s http://127.0.0.1:3000/api/health
```

`db`, `web` and `worker` should be **Up** (web "healthy"), `migrate` **Exited (0)**, and health should show
`"status":"ok"`.

Tip — save typing with an alias (add it to `~/.bashrc`):

```bash
alias dc='docker compose -f ~/shayvera/docker-compose.prod.yml --env-file ~/shayvera/.env.production'
```

The rest of this guide uses `dc`.

## 7. Products and the admin account

**Admin account** (pick a strong password; it is asked for hidden):

```bash
cd ~/shayvera
dc run --rm migrate npm run admin:create -- --email you@yourdomain.in --name "Your Name"
```

**Products** — choose one:

- Add your real catalogue in **Admin → Products / Categories**, or
- Load the demo catalogue to try the site first (categories + 23 products, **without** fake orders):

  ```bash
  dc run --rm -e SEED_DEMO_ORDERS=false migrate npm run db:seed
  ```

  The seed also creates a demo customer (`customer@shayvera.local`, password in the seed output). Before
  launch, **disable** it in Admin → Customers, and archive any demo products you don't sell.

## 8. HTTPS with Caddy

Caddy gets and renews free HTTPS certificates automatically. Install (official instructions:
<https://caddyserver.com/docs/install#debian-ubuntu-raspbian>):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Use the example config with your domain:

```bash
sudo cp ~/shayvera/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i 's/www.shop.example.in/www.shayvera.in/; s/shop.example.in/shayvera.in/g' /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Open `https://shayvera.in` — the store should load with a padlock. Sign in at `/login` with the admin account
and open `/admin`. If HTTPS fails, DNS usually hasn't reached the server yet: `sudo journalctl -u caddy -n 50`.

## 9. Connect the outside services

- **Razorpay** → Dashboard → Settings → Webhooks → Add: URL `https://shayvera.in/api/webhooks/razorpay`,
  a secret you invent (put the same value in `RAZORPAY_WEBHOOK_SECRET`), events `payment.authorized`,
  `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`. See `PAYMENT_INTEGRATION.md`.
- **Shiprocket** (optional) → webhook URL `https://shayvera.in/api/webhooks/courier`, token =
  `SHIPROCKET_WEBHOOK_TOKEN`. See `SHIPPING_INTEGRATION.md`.
- **MSG91** (optional) → set `SMS_PROVIDER="msg91"` and the `MSG91_*` values.

After changing `.env.production`, apply it: `dc up -d` (containers are recreated with the new values).

Then open **Admin → Background jobs → System status**: every integration's mode is listed there.

## 10. Before real customers

1. Place a COD order and a Razorpay **test** order end to end; check the emails arrive.
2. Check Admin → Settings (store name, GSTIN, addresses, shipping charges).
3. Switch Razorpay to **live** keys (and a live webhook) only after the test order works.
4. Set up backups (step 11) and confirm one backup file exists.

## 11. Backups

`scripts/ops/backup.sh` backs up the database (checked by reading it back) and every uploaded image into
`~/shayvera-backups`, keeping 14 days of database and 7 days of image backups. Set it to run nightly
(about 02:30 India time) and take the first backup now:

```bash
bash ~/shayvera/scripts/ops/backup.sh --install-cron
bash ~/shayvera/scripts/ops/backup.sh
bash ~/shayvera/scripts/ops/backup.sh --list
```

Nightly runs are logged to `~/shayvera-backups/backup.log`. The deploy script also takes a `pre-deploy-…`
database backup before every update.

**Keep copies off the server** — a backup on the server is lost with it. From your PC (PowerShell):

```bash
scp -r root@YOUR_SERVER_IP:/root/shayvera-backups ./shayvera-backups
```

and keep the hosting provider's VPS snapshots switched on.

### Restoring

Check a backup without touching the live site (restores into a separate database):

```bash
dc exec -T db createdb -U shayvera shayvera_check
dc exec -T db pg_restore -U shayvera -d shayvera_check --no-owner --exit-on-error < ~/shayvera-backups/db-YYYYMMDD-HHMMSS.dump
dc exec -T db psql -U shayvera -d shayvera_check -Atc 'select count(*) from "Order"'
dc exec -T db dropdb -U shayvera shayvera_check
```

Replacing live data is a last resort (it discards everything after the backup). Take a fresh backup first,
then stop the site, recreate the database, restore, and start again:

```bash
bash ~/shayvera/scripts/ops/backup.sh
dc stop web worker
dc exec -T db dropdb -U shayvera shayvera
dc exec -T db createdb -U shayvera shayvera
dc exec -T db pg_restore -U shayvera -d shayvera --no-owner --exit-on-error < ~/shayvera-backups/db-YYYYMMDD-HHMMSS.dump
dc run --rm --no-deps -T migrate sh -c 'tar xzf - -C /app/storage/uploads' < ~/shayvera-backups/uploads-YYYYMMDD-HHMMSS.tgz
dc up -d
```

## 12. Updating the site later

Push your changes to GitHub, then on the server:

```bash
bash ~/shayvera/scripts/ops/deploy.sh
```

The script backs up the database (to `~/shayvera-backups`, newest 10 kept), downloads the new code, builds
the new version while the old one keeps serving, applies database migrations, restarts web + worker and
waits until the site is healthy. If the new version does not become healthy, it puts the previous version
back automatically. If it finds nothing new, it changes nothing.

| Option       | What it does                                                        |
| ------------ | ------------------------------------------------------------------- |
| _(none)_     | Update to the latest code on GitHub                                 |
| `--force`    | Rebuild and restart even if there is no new code                    |
| `--rollback` | Go back to the version before the last update (run again to return) |

Every run is logged to `~/shayvera/deploy.log`. Settings-only changes (`.env.production`) need just `dc up -d`.

## 13. Everyday commands

| Task                          | Command                                      |
| ----------------------------- | -------------------------------------------- |
| Status                        | `dc ps`                                      |
| Live logs                     | `dc logs -f web` (or `worker`, `db`)         |
| Restart                       | `dc restart web worker`                      |
| Stop everything               | `dc down` (data is kept)                     |
| Health                        | `curl -s http://127.0.0.1:3000/api/health`   |
| Disk usage / clean old images | `docker system df` / `docker image prune -f` |

**Never** run `dc down -v` — `-v` deletes the database and uploaded images.

## Scaling later

This setup is one server. Before running more than one web server, move images to S3-compatible storage
(`STORAGE_DRIVER=s3`) and the database to a managed PostgreSQL with point-in-time recovery — see
`PRODUCTION_READINESS.md` §4.
