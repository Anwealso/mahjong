# Deploying to Fly.io

The game runs as **one Fly.io machine in Sydney (`syd`)** that serves both the built client and the
WebSocket at `/ws` ([D8](decisions.md#d8-hosting-one-service-serving-the-client-and-the-websocket-on-the-same-origin),
[D25](decisions.md#d25-flyio-in-sydney-one-machine-that-stops-when-idle-deploys-from-github-actions)). It stops itself when nobody is
connected and starts again on the next visit (about 1–3 s). GitHub Actions deploys every push to `main`
once the tests pass.

## One-time setup (you)

These steps need your accounts, so they can't be automated from the repo.

1. **Install the Fly CLI** (macOS):

   ```sh
   brew install flyctl
   ```

2. **Sign up / log in**, then add a payment card in the Fly dashboard (new accounts have no free tier; this
   app costs about $2/month or less):

   ```sh
   fly auth signup    # or: fly auth login
   ```

3. **Create the app.** The name becomes the URL (`https://<name>.fly.dev`) and must be unique across Fly.
   The repo's `fly.toml` uses `anwealso-mahjong`; if that's taken, pick another and change `app = "…"` in
   `fly.toml` to match.

   ```sh
   fly apps create anwealso-mahjong
   ```

4. **Create a deploy token** for GitHub Actions (it can only deploy this one app):

   ```sh
   fly tokens create deploy -a anwealso-mahjong
   ```

   Copy the whole output (it starts with `FlyV1 …`).

5. **Add it to GitHub:** repo **Settings → Secrets and variables → Actions → New repository secret**.
   Name: `FLY_API_TOKEN`. Value: the token from step 4.

6. **First deploy.** Either merge the branch into `main` (Actions deploys it), or deploy from your laptop in
   the repo root:

   ```sh
   fly deploy --ha=false
   ```

   `--ha=false` matters: by default Fly creates **two** machines on the first deploy, but rooms live in
   memory, so there must be exactly **one**. Check with `fly status`; if you ever see two machines, run
   `fly scale count 1`.

7. **Check it works:** open `https://anwealso-mahjong.fly.dev`, and `https://anwealso-mahjong.fly.dev/health`
   should return `{"ok":true,"rooms":0}`.

## Day to day

- **Deploying:** push to `main`. The *Deploy* workflow runs typecheck + tests, then `flyctl deploy`.
  Pull requests run the tests only.
- **A deploy restarts the server and ends any game in progress** ([D25](decisions.md#d25-flyio-in-sydney-one-machine-that-stops-when-idle-deploys-from-github-actions)).
  Players see "The server is restarting" and then that their room is gone. Avoid merging to `main`
  while people are playing; `/health` shows how many rooms are open.
- **Logs:** `fly logs`. **Status:** `fly status`. **Open the site:** `fly open`.
- **Cost:** `shared-cpu-1x` with 256 MB is about $1.94/month if it ran all the time; it's billed per second
  only while running, and it stops when idle.

## Running a production build locally

```sh
npm run build        # client → packages/client/dist, server → packages/server/dist
npm start            # serves everything on http://localhost:8080
```

Or exactly as Fly runs it:

```sh
docker build -t mahjong . && docker run -p 8080:8080 mahjong
```
