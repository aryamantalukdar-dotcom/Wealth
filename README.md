# 💷 Our Wealth Dashboard

A shared, web-based wealth tracker for two people. You each update your own
figures on your own tab, and the **Dashboard** rolls everything up into a
combined view of your net worth, breakdown, trajectory, and savings insights.

Built with Node + Express + SQLite. All figures are in **GBP (£)**.

---

## What it does

- **Two partner tabs** — each person records, per month:
  - Current account balance
  - Cash savings
  - Investments (stocks, pension, crypto, etc.)
  - Credit card outstanding (amount owed)
  - Amount saved that month
- **Combined dashboard** with:
  - Total net worth = accounts + cash + investments − credit-card debt
  - Category breakdown of what makes up your wealth
  - Net-worth split between the two of you (doughnut chart)
  - **Net-worth trajectory** over time, plus a projection of where you're
    heading based on your average monthly saving
  - **Insights** — emergency-fund buffer, "clear the credit card first",
    saving momentum, cash-vs-investment balance, and time-to-milestone
  - **Goals progress strip** summarising how you're tracking against this
    year's targets
- **Targets tab** — set two shared, linked goals for any year and track
  progress:
  - Net worth to reach by year end
  - Monthly saving target
  The two are two views of the same plan and stay in sync: editing one
  recalculates the other from today's net worth and the months left in the
  year (monthly saving × months remaining + net worth now = year-end net
  worth). Each goal gets a progress bar plus tailored guidance on whether
  you're on track and how to close any gap.
- Rename each partner to your actual names.
- Everything is stored in a shared SQLite database, so whatever one of you
  saves is instantly visible to the other.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

- Change the port with `PORT=8080 npm start`.
- The database lives at `data/wealth.db` by default (created automatically on
  first run). Override with `WEALTH_DB=/path/to/wealth.db`.

## Using it together

Because the data is shared server-side, the two of you just need to reach the
same running instance:

- **Same home network:** run it on one always-on machine and both browse to
  `http://<that-machine-ip>:3000` from your phones/laptops.
- **Hosted:** deploy to any host that runs Node (Railway, Render, Fly.io, a
  small VPS, etc.). Keep the `data/` directory on a persistent disk so your
  history isn't lost on redeploy.

Open your own tab, update your numbers whenever they change (monthly works
well), and watch the combined picture on the Dashboard.

## Notes

- Credit-card figures are entered as the amount **owed** and subtracted from
  net worth automatically.
- The projection is a straight-line estimate from your recent average monthly
  saving — it deliberately ignores investment growth, so real returns should
  put you ahead of the dashed line.
- The insights are general guidance to help you save more, not regulated
  financial advice.

## Project layout

```
server.js            Express API + static hosting
db.js                SQLite schema + connection
public/index.html    App shell
public/styles.css    Styling
public/app.js        Frontend logic, charts, insights
public/vendor/       Chart.js (vendored, no CDN needed)
```
