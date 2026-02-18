#!/usr/bin/env node
/**
 * get-gmail-token.js
 *
 * Local helper to complete the Gmail OAuth2 flow and obtain a refresh token.
 *
 * Usage:
 *   GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=yyy node get-gmail-token.js
 *
 * Or just run it and paste the values when prompted.
 *
 * Prerequisites:
 *   1. A Google Cloud project with the Gmail API enabled.
 *   2. An OAuth 2.0 "Web application" client whose redirect URIs include:
 *        http://localhost:3456/callback
 *   3. The OAuth consent screen must list meir@cnscoinc.com as a test user
 *      (or be published).
 */

const http = require("http");
const { URL } = require("url");
const readline = require("readline");

const CALLBACK_PORT = 3456;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getCredentials() {
  let clientId = (process.env.GMAIL_CLIENT_ID || "").trim();
  let clientSecret = (process.env.GMAIL_CLIENT_SECRET || "").trim();

  if (!clientId) {
    clientId = await ask("Enter your Gmail OAuth Client ID: ");
  }
  if (!clientSecret) {
    clientSecret = await ask("Enter your Gmail OAuth Client Secret: ");
  }

  if (!clientId || !clientSecret) {
    console.error("Error: Client ID and Client Secret are required.");
    process.exit(1);
  }

  return { clientId, clientSecret };
}

function buildAuthUrl(clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent"
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchangeCodeForTokens(code, clientId, clientSecret) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code"
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("\nToken exchange failed:");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  return data;
}

async function main() {
  const { clientId, clientSecret } = await getCredentials();

  const authUrl = buildAuthUrl(clientId);

  console.log("\n=== Gmail OAuth2 Flow ===\n");
  console.log("IMPORTANT: Before continuing, make sure your Google Cloud OAuth client");
  console.log("has this redirect URI configured:\n");
  console.log(`  ${REDIRECT_URI}\n`);
  console.log("Open this URL in your browser to authorize:\n");
  console.log(`  ${authUrl}\n`);
  console.log("Waiting for callback on port", CALLBACK_PORT, "...\n");

  // Try to open the browser automatically
  try {
    const { exec } = require("child_process");
    const platform = process.platform;
    if (platform === "darwin") {
      exec(`open "${authUrl}"`);
    } else if (platform === "win32") {
      exec(`start "${authUrl}"`);
    } else {
      exec(`xdg-open "${authUrl}"`);
    }
  } catch (_err) {
    // Ignore — user can open manually
  }

  // Start local server to catch the callback
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><p>${error}</p><p>You can close this tab.</p>`);
        console.error("OAuth error:", error);
        server.close();
        process.exit(1);
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Error</h1><p>No code received.</p>");
        return;
      }

      console.log("Received authorization code. Exchanging for tokens...\n");

      try {
        const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Success!</h1><p>Refresh token obtained. You can close this tab and return to the terminal.</p>"
        );

        console.log("=== SUCCESS ===\n");

        if (tokens.refresh_token) {
          console.log("Refresh Token:\n");
          console.log(`  ${tokens.refresh_token}\n`);
        } else {
          console.log("WARNING: No refresh_token returned. This usually means:");
          console.log('  - You did not include prompt=consent (already handled)');
          console.log("  - The app was previously authorized. Revoke access at:");
          console.log("    https://myaccount.google.com/permissions");
          console.log("  Then run this script again.\n");
        }

        if (tokens.access_token) {
          console.log("Access Token (temporary, for testing):\n");
          console.log(`  ${tokens.access_token.slice(0, 40)}...\n`);
        }

        console.log("--- Railway environment variables to set ---\n");
        console.log(`  RELAY_FROM_EMAIL=meir@cnscoinc.com`);
        console.log(`  GMAIL_CLIENT_ID=${clientId}`);
        console.log(`  GMAIL_CLIENT_SECRET=${clientSecret}`);
        if (tokens.refresh_token) {
          console.log(`  GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
        }
        console.log("\nDone! Set these in Railway and redeploy.");
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><p>${err.message}</p>`);
        console.error("Token exchange error:", err.message);
      }

      server.close();
      resolve();
    });

    server.listen(CALLBACK_PORT, () => {
      // Server ready
    });
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
