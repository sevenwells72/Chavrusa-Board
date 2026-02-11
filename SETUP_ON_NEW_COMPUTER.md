# Setup On New Computer

## 1. Install Node.js (macOS/Homebrew)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@20
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node -v
npm -v
```

## 2. Get the project code

If using GitHub:

```bash
git clone <YOUR_REPO_URL> "/Users/<your-user>/Documents/chavrus Board"
cd "/Users/<your-user>/Documents/chavrus Board"
```

If copying manually, place the folder at:

`/Users/<your-user>/Documents/chavrus Board`

## 3. Install dependencies

```bash
cd "/Users/<your-user>/Documents/chavrus Board"
npm install
```

## 4. Copy your private env file

From old computer, copy:

`/Users/michaelgross/Documents/chavrus Board/.env`

To new computer:

`/Users/<your-user>/Documents/chavrus Board/.env`

If you do not have it, create from template:

```bash
cp .env.example .env
```

Then fill real values.

## 5. Copy your SQLite data (important)

From old computer, copy:

`/Users/michaelgross/Documents/chavrus Board/data/chavrus.db`

To new computer:

`/Users/<your-user>/Documents/chavrus Board/data/chavrus.db`

If `chavrus.db` does not exist yet on old machine, copy:

`/Users/michaelgross/Documents/chavrus Board/data/posts.json`

and run once on the new machine; the app will auto-migrate JSON into SQLite.

## 6. Start the app

```bash
cd "/Users/<your-user>/Documents/chavrus Board"
npm start
```

Open:

[http://localhost:3000](http://localhost:3000)

## 7. Quick verification checklist

1. Browse page loads and shows posts.
2. Post a request works.
3. Respond form works.
4. Manage link works (edit/renew/deactivate).

## Notes

- Keep `.env` private.
- If SMTP is not configured, core local flows still work; relay email delivery may be skipped/warned.
