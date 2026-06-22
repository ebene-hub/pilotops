# Pilot Ops stream server on AWS EC2 (free tier)

This stands up the **live-video media server** (MediaMTX + stream-gateway + Caddy)
on one small EC2 instance. The web app stays on Vercel and the database on
Supabase Cloud — this box only relays the controller's cast and records it.

You need: the AWS account you created, ~20 minutes, and a **hostname** for the
server (a subdomain you own, or a free DuckDNS name — see step 5).

---

## 1. Launch the EC2 instance

AWS Console → **EC2** → **Launch instance**:

- **Name:** `pilotops-stream`
- **AMI:** *Ubuntu Server 24.04 LTS* (must say "Free tier eligible")
- **Instance type:** `t2.micro` (or `t3.micro`) — Free tier eligible
- **Key pair:** *Create new key pair* → RSA → `.pem` → **Download it** (you'll SSH with this; keep it safe)
- **Network settings → Edit → Create security group** with these inbound rules:

  | Type | Protocol | Port | Source | Why |
  |------|----------|------|--------|-----|
  | SSH | TCP | 22 | **My IP** | admin access |
  | HTTP | TCP | 80 | Anywhere `0.0.0.0/0` | Caddy TLS challenge + redirect |
  | HTTPS | TCP | 443 | Anywhere | WHEP/HLS playback |
  | Custom TCP | TCP | 1935 | Anywhere | RTMP ingest from the controller |
  | Custom UDP | UDP | 8189 | Anywhere | WebRTC media |

- **Storage:** 30 GiB gp3 (free tier covers up to 30 GB)
- **Launch instance.**

## 2. Give it a stable IP (Elastic IP)

EC2 → **Elastic IPs** → **Allocate** → then **Actions → Associate** to your
instance. This keeps the IP fixed if the instance ever restarts. (Free while
attached to a running instance.)

## 3. Connect

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@YOUR_ELASTIC_IP
```

## 4. Install Docker + a little swap (1 GB RAM is tight)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# 1 GB swap so builds/encoding don't OOM
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Log out and back in (`exit`, then SSH again) so the docker group applies.

## 5. Point a hostname at the server

Caddy needs a real hostname to get an HTTPS certificate (the Vercel app is HTTPS,
so the stream URL must be HTTPS too).

- **Have a domain?** Add a DNS **A record**: `stream.yourdomain.com → YOUR_ELASTIC_IP`.
- **No domain?** Use free **DuckDNS**: sign in at https://www.duckdns.org, create
  e.g. `pilotops-stream`, and set its IP to `YOUR_ELASTIC_IP`. Your hostname is
  `pilotops-stream.duckdns.org`.

Wait a minute for DNS, then `ping YOUR_HOSTNAME` should show the Elastic IP.

## 6. Deploy

```bash
git clone https://github.com/ebene-hub/pilotops.git
cd pilotops/deploy/stream-server
cp .env.example .env
nano .env
```
Set in `.env`:
```
STREAM_DOMAIN=YOUR_HOSTNAME              # from step 5
SUPABASE_URL=https://zfpuulhgcubndcywfjxy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...            # Supabase → Settings → API → service_role
```
Then:
```bash
docker compose up -d --build
docker compose logs -f caddy            # watch it obtain the TLS cert
```
Check it's serving (after the cert is issued):
```bash
curl -I https://YOUR_HOSTNAME/          # expect HTTP/2 200
```

## 7. Point the apps at it

**Vercel** (Project → Settings → Environment Variables) → add and **redeploy**:
```
VITE_STREAM_URL=https://YOUR_HOSTNAME/stream
VITE_STREAM_HLS_URL=https://YOUR_HOSTNAME/hls
```

**Android app** (`android/gradle.properties`, then rebuild the APK):
```
STREAM_HOST=YOUR_HOSTNAME
STREAM_SCHEME=rtmp
```

## 8. Test it

1. In Pilot Ops, **start a mission** → note the 6-digit pairing code.
2. On the controller (or any Android device for a first test), open **GGIS UAV
   Companion**, sign in, enter the code, **Start casting**.
3. The flight's **Live stream** should flip from "Waiting for controller" to the
   live feed; on the admin side it shows "Controller connected".
4. Stop casting → a recording is uploaded and attached to the flight's media.

**Quick check without the app** (run anywhere with ffmpeg; `<flightId>` is the
flight's uuid, `<jwt>` a signed-in pilot's access token):
```bash
ffmpeg -re -i sample.mp4 -c:v libx264 -tune zerolatency -c:a aac \
  -f flv "rtmp://YOUR_HOSTNAME:1935/<flightId>?token=<jwt>"
```

## Notes
- **Cost:** the t2.micro is free for 12 months (750 hrs/mo = always-on). Outbound
  data has a free monthly allowance; heavy multi-viewer streaming can exceed it —
  fine for testing and small ops.
- **Updating:** `git pull && docker compose up -d --build`.
- **Logs:** `docker compose logs -f stream-gateway` shows auth allow/deny and
  recording uploads.
