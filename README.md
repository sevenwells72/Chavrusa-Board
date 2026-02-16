# Chavrusashaft (v1 MVP)

Public bulletin board for chavrusa learning requests with private relay messaging.

## Pages

- `/` Home/Browse
  - Brief explanation
  - Filters: category, format, time zone
  - Active posts only
  - `Respond` button on each post
- `/post` Post a Request
  - Required form fields from product spec
  - Duration-based expiration (7/14/30 days)
  - Private manage link shown after posting
- `/respond/:id` Respond to a Post
  - Relay message form
  - No direct contact details exposed publicly
- `/manage/:token` Optional My Post management
  - Edit
  - Renew (7/14/30 days)
  - Mark inactive
  - View incoming responses and send relay replies

## Behavior

- No matching algorithm, no profiles, no ratings.
- Posts auto-hide when expired.
- Location is shown only for in-person only/preferred posts.
- Emails are used privately for relay; not public.
- Basic anti-spam rate limits on post creation and responses.
- Data is stored in SQLite (`data/chavrus.db` by default).
- If `data/posts.json` exists and DB is empty, data is auto-migrated on first run.

## Run

1. Install dependencies:
```bash
npm install
```
2. Configure environment:
```bash
cp .env.example .env
```
3. Start server:
```bash
npm start
```

Open `http://localhost:3000`.

## Multi-Computer Workflow

- Commit/push code to Git.
- For shared data across computers, deploy this app with a persistent database.
- If running locally on multiple computers, copy both:
  - `data/chavrus.db`
  - `.env`
