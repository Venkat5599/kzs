# Deploying Kairos

Two targets, both live.

| | URL |
|---|---|
| Vercel | https://frontend-m4djfjn9u-venkat5599s-projects.vercel.app |
| VPS | https://kairos.187.127.137.136.sslip.io |

## Vercel

Deploy from `apps/frontend` (Root Directory = `apps/frontend`):

```bash
cd apps/frontend && bunx vercel --prod
```

Three things had to be true for this to work, and each was hidden behind the
previous one:

1. `apps/frontend/vercel.json` pins **bun** for install and build. Without it
   Vercel falls back to npm and the workspace install fails.
2. `apps/frontend/tsconfig.json` is **self-contained**. It cannot `extends`
   `../../tsconfig.base.json`, because that file is outside the uploaded
   subtree. The strict options are duplicated and must be kept in sync by hand.
3. `next.config.ts` applies `outputFileTracingRoot` **only off Vercel**. On
   Vercel it escapes the deployment and Next looks for the routes manifest at a
   doubled path (`/vercel/path0/vercel/path0/.next/...`).

## VPS

Host `187.127.137.136`, key `~/.ssh/agent_fabric_vps`. Caddy already serves
several other sites there; the Kairos block is additive and the config is
backed up before every change.

Build **on the VPS**, not locally. A Windows build produces symlinks tar cannot
carry and a `win32-x64` sharp binary Linux cannot load.

```bash
# from the repo root
tar --exclude=node_modules --exclude=.next --exclude=.git \
    --exclude=contracts/artifacts --exclude=contracts/cache --exclude=.env \
    -czf /tmp/kairos-src.tgz .
scp -i ~/.ssh/agent_fabric_vps /tmp/kairos-src.tgz root@187.127.137.136:/tmp/

ssh -i ~/.ssh/agent_fabric_vps root@187.127.137.136
rm -rf /opt/kairos && mkdir -p /opt/kairos
tar -xzf /tmp/kairos-src.tgz -C /opt/kairos
cd /opt/kairos/apps/frontend
bun install --no-save
bun run build

# standalone does not include these — copy them alongside
cp -r .next/static  .next/standalone/apps/frontend/.next/static
cp -r public        .next/standalone/apps/frontend/public

systemctl restart kairos-frontend
```

**If `bun install` fails to extract the `next` tarball**, the bun cache is
corrupt. `rm -rf ~/.bun/install/cache` and retry — this happened on the first
deploy and the error message does not suggest the cause.

### Service

`/etc/systemd/system/kairos-frontend.service` runs the standalone server on
`127.0.0.1:3200`, restarts on failure, and is enabled at boot.

```bash
systemctl status kairos-frontend
journalctl -u kairos-frontend -f
```

### Reverse proxy

```
kairos.187.127.137.136.sslip.io {
	reverse_proxy localhost:3200
}
```

Caddy handles TLS automatically. Validate before reloading — the same file
serves other production sites:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
```
