# Deploying the Wealth dashboard (free)

This app is a Node/Express server with a Turso (cloud SQLite) database and a
shared password. Hosting is free on **Render**, data lives in **Turso** (free),
and you open it from any device at one URL.

There are three env vars the app needs in production:

| Variable             | What it is                                             |
| -------------------- | ------------------------------------------------------ |
| `APP_PASSWORD`       | The single password you both type to sign in           |
| `TURSO_DATABASE_URL` | Your Turso database URL (starts with `libsql://`)      |
| `TURSO_AUTH_TOKEN`   | Turso auth token for that database                     |

---

## 1. Create the database (Turso)

1. Go to https://turso.tech and sign up (GitHub login is fine — no card).
2. Create a database (any name, e.g. `wealth`). Pick the region closest to you.
3. On the database page, copy the **Database URL** (`libsql://...`).
4. Create a **database token** and copy it.
   Keep both — they are `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

The app creates its own tables on first run, so there's nothing else to set up.

## 2. Deploy the app (Render)

1. Go to https://render.com and sign up with GitHub (no card for the free tier).
2. **New → Web Service**, connect this GitHub repo, pick the branch you pushed.
3. Render reads `render.yaml` and pre-fills build/start commands. If asked:
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Add the three environment variables (Environment tab):
   - `APP_PASSWORD` = a password of your choosing
   - `TURSO_DATABASE_URL` = the `libsql://...` URL from Turso
   - `TURSO_AUTH_TOKEN` = the token from Turso
5. Create the service. First build takes a few minutes.
6. When it's live you get a URL like `https://wealth-xxxx.onrender.com`.
   Open it on any device, enter the password, done.

### Note on the free tier
Render's free web service **sleeps after ~15 minutes of inactivity**, so the
first visit after a quiet period takes ~30–50 seconds to wake up. Subsequent
loads are instant. Your data is safe regardless — it lives in Turso, not on
Render's disk.

---

## Running locally (development)

With no env vars set, the app uses a local SQLite file at `data/wealth.db`
and the password defaults to `changeme`:

```bash
npm install
npm start
# open http://localhost:3000  (password: changeme)
```

To test against Turso locally, set the three env vars before `npm start`.
