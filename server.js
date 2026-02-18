const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const nodemailer = require("nodemailer");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, "data");
const postsJsonPath = path.join(dataDir, "posts.json");
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, "chavrus.db");
const allowedDurations = new Set([7, 14, 30]);
const allowedFormats = new Set([
  "in_person_only",
  "in_person_preferred",
  "remote_only",
  "flexible"
]);
const rateBuckets = new Map();

let db;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function nowIso() {
  return new Date().toISOString();
}

function buildBaseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function randomToken(size = 16) {
  return crypto.randomBytes(size).toString("hex");
}

function normalize(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeTime(value) {
  const match = normalize(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function titleCaseWords(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function parseAvailabilitySlots(value) {
  let rawSlots = value;
  if (typeof rawSlots === "string") {
    try {
      rawSlots = JSON.parse(rawSlots);
    } catch (_error) {
      return [];
    }
  }
  if (!Array.isArray(rawSlots)) {
    return [];
  }

  const slots = [];
  for (const entry of rawSlots) {
    const day = normalize(entry?.day);
    const start = normalizeTime(entry?.start);
    const end = normalizeTime(entry?.end);
    const flexible = Boolean(entry?.flexible);
    if (!day) {
      continue;
    }
    if (!flexible && (!start || !end || start >= end)) {
      continue;
    }
    slots.push({
      day,
      start: flexible ? "" : start,
      end: flexible ? "" : end,
      flexible
    });
  }
  return slots;
}

function parseSlotsFromRow(rowValue) {
  try {
    const parsed = JSON.parse(rowValue || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function toSafeBool(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return fallback;
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const portValue = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const looksLikePlaceholder =
    !host ||
    !user ||
    !pass ||
    host.includes("example.com") ||
    user.includes("your_smtp_user") ||
    pass.includes("your_smtp_password");

  if (looksLikePlaceholder) {
    return null;
  }

  const transportOptions = {
    host,
    port: portValue,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  };

  // Gmail shortcut — more reliable on cloud hosts that may block raw SMTP ports.
  if (host === "smtp.gmail.com") {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }

  return nodemailer.createTransport(transportOptions);
}

function toPublicPost(post) {
  const showLocation =
    post.format === "in_person_only" || post.format === "in_person_preferred";
  const postCode = `CB-${String(post.id || "").slice(0, 6).toUpperCase()}`;

  return {
    id: post.id,
    postCode,
    category: post.category,
    seferName: post.seferName,
    topic: post.topic,
    learningStyle: post.learningStyle,
    familiarityLevel: post.familiarityLevel,
    timeZone: post.timeZone,
    availabilityNotes: post.availabilityNotes,
    availabilitySlots: parseSlotsFromRow(post.availabilitySlots),
    openToOtherTimes: Boolean(post.openToOtherTimes),
    format: post.format,
    city: showLocation ? post.city : "",
    state: showLocation ? post.state : "",
    posterName: titleCaseWords(post.posterName),
    createdAt: post.createdAt,
    expiresAt: post.expiresAt
  };
}

function applyRateLimit(req, key, limit, windowMs) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const existing = rateBuckets.get(bucketKey) || [];
  const kept = existing.filter((ts) => now - ts < windowMs);
  if (kept.length >= limit) {
    return false;
  }
  kept.push(now);
  rateBuckets.set(bucketKey, kept);
  return true;
}

function validatePostPayload(payload, options = {}) {
  const requireDuration = options.requireDuration !== false;
  const category = normalize(payload.category) || "Other";
  const seferName = normalize(payload.seferName);
  const topic = normalize(payload.topic) || "Untitled request";
  const learningStyle = normalize(payload.learningStyle);
  const familiarityLevel = normalize(payload.familiarityLevel);
  const timeZone = normalize(payload.timeZone) || "America/New_York";
  const availabilityNotes = normalize(payload.availabilityNotes || payload.availability);
  const availabilitySlots = parseAvailabilitySlots(payload.availabilitySlots);
  const openToOtherTimes = toSafeBool(payload.openToOtherTimes, false);
  const format = allowedFormats.has(normalize(payload.format))
    ? normalize(payload.format)
    : "flexible";
  const city = normalize(payload.city);
  const state = normalize(payload.state);
  const email = normalize(payload.email);
  const posterName = normalize(payload.posterName);
  const contactMethod = normalize(payload.contactMethod || "relay");
  const durationDays = Number(payload.durationDays);
  const finalDurationDays = allowedDurations.has(durationDays) ? durationDays : 30;

  const needsLocation = format === "in_person_only" || format === "in_person_preferred";

  if (contactMethod !== "relay") {
    return { error: "Only relay contact is supported." };
  }

  return {
    value: {
      category,
      seferName,
      topic,
      learningStyle,
      familiarityLevel,
      timeZone,
      availabilityNotes,
      availabilitySlots,
      openToOtherTimes,
      format,
      city: needsLocation ? city : "",
      state: needsLocation ? state : "",
      email,
      posterName: titleCaseWords(posterName),
      contactMethod,
      durationDays: requireDuration ? finalDurationDays : undefined
    }
  };
}

function initDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      manageToken TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      seferName TEXT NOT NULL DEFAULT '',
      topic TEXT NOT NULL,
      learningStyle TEXT NOT NULL,
      familiarityLevel TEXT NOT NULL,
      timeZone TEXT NOT NULL,
      availabilityNotes TEXT NOT NULL DEFAULT '',
      availabilitySlots TEXT NOT NULL DEFAULT '[]',
      openToOtherTimes INTEGER NOT NULL DEFAULT 0,
      format TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      contactMethod TEXT NOT NULL,
      posterName TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      durationDays INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      postId TEXT NOT NULL,
      responderEmail TEXT NOT NULL,
      message TEXT NOT NULL,
      timeZone TEXT NOT NULL DEFAULT '',
      availability TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  ensurePostsSchema();
  migrateFromJsonIfNeeded();
}

function ensurePostsSchema() {
  const columns = db.prepare("PRAGMA table_info(posts)").all();
  const columnNames = new Set(columns.map((column) => column.name));
  const hasSeferName = columnNames.has("seferName");
  const hasAvailabilityNotes = columnNames.has("availabilityNotes");
  const hasAvailabilitySlots = columnNames.has("availabilitySlots");
  const hasOpenToOtherTimes = columnNames.has("openToOtherTimes");
  const hasAvailability = columns.some((column) => column.name === "availability");
  const missingColumnStatements = [
    ["seferName", "ALTER TABLE posts ADD COLUMN seferName TEXT NOT NULL DEFAULT ''"],
    ["availabilityNotes", "ALTER TABLE posts ADD COLUMN availabilityNotes TEXT NOT NULL DEFAULT ''"],
    ["availabilitySlots", "ALTER TABLE posts ADD COLUMN availabilitySlots TEXT NOT NULL DEFAULT '[]'"],
    ["openToOtherTimes", "ALTER TABLE posts ADD COLUMN openToOtherTimes INTEGER NOT NULL DEFAULT 0"],
    ["posterName", "ALTER TABLE posts ADD COLUMN posterName TEXT NOT NULL DEFAULT ''"],
    ["durationDays", "ALTER TABLE posts ADD COLUMN durationDays INTEGER NOT NULL DEFAULT 30"],
    ["createdAt", "ALTER TABLE posts ADD COLUMN createdAt TEXT NOT NULL DEFAULT ''"],
    ["expiresAt", "ALTER TABLE posts ADD COLUMN expiresAt TEXT NOT NULL DEFAULT ''"],
    ["status", "ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"]
  ];
  for (const [columnName, statement] of missingColumnStatements) {
    if (!columnNames.has(columnName)) {
      db.exec(statement);
    }
  }

  if (hasAvailability) {
    db.exec(
      "UPDATE posts SET availabilityNotes = CASE WHEN TRIM(availabilityNotes) = '' THEN availability ELSE availabilityNotes END"
    );
  }
}

function migrateFromJsonIfNeeded() {
  const postCount = db.prepare("SELECT COUNT(*) AS count FROM posts").get().count;
  if (postCount > 0 || !fs.existsSync(postsJsonPath)) {
    return;
  }

  const raw = fs.readFileSync(postsJsonPath, "utf8");
  const legacyPosts = JSON.parse(raw);
  if (!Array.isArray(legacyPosts) || !legacyPosts.length) {
    return;
  }

  const insertPost = db.prepare(`
    INSERT INTO posts (
      id, manageToken, category, seferName, topic, learningStyle, familiarityLevel, timeZone, availabilityNotes,
      availabilitySlots, openToOtherTimes, format, city, state, contactMethod, posterName, email, durationDays, createdAt, expiresAt, status
    ) VALUES (
      @id, @manageToken, @category, @seferName, @topic, @learningStyle, @familiarityLevel, @timeZone, @availabilityNotes,
      @availabilitySlots, @openToOtherTimes, @format, @city, @state, @contactMethod, @posterName, @email, @durationDays, @createdAt, @expiresAt, @status
    )
  `);

  const insertConversation = db.prepare(`
    INSERT INTO conversations (
      id, postId, responderEmail, message, timeZone, availability, createdAt
    ) VALUES (
      @id, @postId, @responderEmail, @message, @timeZone, @availability, @createdAt
    )
  `);

  const insertReply = db.prepare(`
    INSERT INTO replies (
      conversationId, message, createdAt
    ) VALUES (
      @conversationId, @message, @createdAt
    )
  `);

  const transaction = db.transaction((posts) => {
    for (const post of posts) {
      insertPost.run({
        id: post.id || randomToken(8),
        manageToken: post.manageToken || randomToken(16),
        category: post.category || "Other",
        seferName: post.seferName || post.topic || "",
        topic: post.topic || "Untitled",
        learningStyle: post.learningStyle || "",
        familiarityLevel: post.familiarityLevel || "Beginner",
        timeZone: post.timeZone || "America/New_York",
        availabilityNotes: post.availabilityNotes || post.availability || "",
        availabilitySlots: JSON.stringify(
          Array.isArray(post.availabilitySlots) ? post.availabilitySlots : []
        ),
        openToOtherTimes: post.openToOtherTimes ? 1 : 0,
        format: post.format || "flexible",
        city: post.city || "",
        state: post.state || "",
        contactMethod: post.contactMethod || "relay",
        posterName: post.posterName || "",
        email: post.email || "missing@example.com",
        durationDays: Number(post.durationDays || 7),
        createdAt: post.createdAt || nowIso(),
        expiresAt: post.expiresAt || nowIso(),
        status: post.status || "active"
      });

      const conversations = Array.isArray(post.conversations) ? post.conversations : [];
      for (const conversation of conversations) {
        const conversationId = conversation.id || randomToken(6);
        insertConversation.run({
          id: conversationId,
          postId: post.id,
          responderEmail: conversation.responderEmail || "missing@example.com",
          message: conversation.message || "",
          timeZone: conversation.timeZone || "",
          availability: conversation.availability || "",
          createdAt: conversation.createdAt || nowIso()
        });

        const replies = Array.isArray(conversation.replies) ? conversation.replies : [];
        for (const reply of replies) {
          insertReply.run({
            conversationId,
            message: reply.message || "",
            createdAt: reply.createdAt || nowIso()
          });
        }
      }
    }
  });

  transaction(legacyPosts);
  console.log(`Migrated ${legacyPosts.length} post(s) from posts.json to SQLite.`);
}

function syncExpiredPosts() {
  db.prepare("UPDATE posts SET status = 'expired' WHERE status = 'active' AND expiresAt <= ?").run(
    nowIso()
  );
}

function defaultValueForRequiredPostColumn(name, type, post) {
  const known = {
    id: post.id,
    manageToken: post.manageToken,
    category: post.category || "Other",
    seferName: post.seferName || "",
    topic: post.topic || "Untitled request",
    learningStyle: post.learningStyle || "",
    familiarityLevel: post.familiarityLevel || "",
    timeZone: post.timeZone || "America/New_York",
    availabilityNotes: post.availabilityNotes || "",
    availabilitySlots: post.availabilitySlots || "[]",
    openToOtherTimes: typeof post.openToOtherTimes === "number" ? post.openToOtherTimes : 0,
    format: post.format || "flexible",
    city: post.city || "",
    state: post.state || "",
    contactMethod: post.contactMethod || "relay",
    posterName: post.posterName || "",
    email: post.email || "",
    durationDays: Number.isFinite(post.durationDays) ? post.durationDays : 30,
    createdAt: post.createdAt || nowIso(),
    expiresAt:
      post.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    status: post.status || "active",
    postCode: `CB-${String(post.id || "").slice(0, 6).toUpperCase()}`
  };
  if (Object.prototype.hasOwnProperty.call(known, name)) {
    return known[name];
  }

  const normalizedType = String(type || "").toUpperCase();
  if (normalizedType.includes("INT")) {
    return 0;
  }
  if (
    normalizedType.includes("REAL") ||
    normalizedType.includes("FLOA") ||
    normalizedType.includes("DOUB")
  ) {
    return 0;
  }
  return "";
}

function insertPostRow(post) {
  const columns = db.prepare("PRAGMA table_info(posts)").all();
  const row = {};

  for (const column of columns) {
    const name = column.name;
    if (Object.prototype.hasOwnProperty.call(post, name)) {
      row[name] = post[name];
      continue;
    }
    const hasDbDefault = column.dflt_value !== null && column.dflt_value !== undefined;
    if (column.notnull && !hasDbDefault) {
      row[name] = defaultValueForRequiredPostColumn(name, column.type, post);
    }
  }

  const names = Object.keys(row);
  if (!names.length) {
    throw new Error("No columns available for insert.");
  }

  const columnList = names.join(", ");
  const valuesList = names.map((name) => `@${name}`).join(", ");
  db.prepare(`INSERT INTO posts (${columnList}) VALUES (${valuesList})`).run(row);
}

function getPostWithConversationsByToken(token) {
  const post = db.prepare("SELECT * FROM posts WHERE manageToken = ?").get(token);
  if (!post) {
    return null;
  }

  const conversations = db
    .prepare(
      `
      SELECT c.id, c.createdAt, c.message, c.timeZone, c.availability, COUNT(r.id) AS replyCount
      FROM conversations c
      LEFT JOIN replies r ON r.conversationId = c.id
      WHERE c.postId = ?
      GROUP BY c.id
      ORDER BY c.createdAt DESC
    `
    )
    .all(post.id)
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      message: row.message,
      timeZone: row.timeZone,
      availability: row.availability,
      replyCount: Number(row.replyCount || 0)
    }));

  return { post, conversations };
}

initDb();

app.get("/api/posts", async (req, res) => {
  try {
    syncExpiredPosts();

    let query = "SELECT * FROM posts WHERE status = 'active' AND expiresAt > ?";
    const params = [nowIso()];
    const category = normalize(req.query.category);
    const format = normalize(req.query.format);
    const timeZone = normalize(req.query.timeZone);

    if (category) {
      query += " AND category = ?";
      params.push(category);
    }
    if (format) {
      query += " AND format = ?";
      params.push(format);
    }
    if (timeZone) {
      query += " AND timeZone = ?";
      params.push(timeZone);
    }

    query += " ORDER BY createdAt DESC";
    const posts = db.prepare(query).all(...params).map(toPublicPost);
    return res.json({ posts });
  } catch (_error) {
    return res.status(500).json({ error: "Could not load posts." });
  }
});

app.get("/api/posts/:id", async (req, res) => {
  try {
    syncExpiredPosts();

    const post = db
      .prepare("SELECT * FROM posts WHERE id = ? AND status = 'active' AND expiresAt > ?")
      .get(req.params.id, nowIso());

    if (!post) {
      return res.status(404).json({ error: "Post not found." });
    }

    return res.json({ post: toPublicPost(post) });
  } catch (_error) {
    return res.status(500).json({ error: "Could not load post." });
  }
});

app.post("/api/posts", async (req, res) => {
  if (!applyRateLimit(req, "create-post", 8, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many posts. Try again later." });
  }

  const validated = validatePostPayload(req.body, { requireDuration: true });
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const data = validated.value;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + data.durationDays * 24 * 60 * 60 * 1000).toISOString();
    const post = {
      id: randomToken(8),
      manageToken: randomToken(16),
      category: data.category,
      seferName: data.seferName,
      topic: data.topic,
      learningStyle: data.learningStyle,
      familiarityLevel: data.familiarityLevel,
      timeZone: data.timeZone,
      availabilityNotes: data.availabilityNotes,
      availabilitySlots: JSON.stringify(data.availabilitySlots),
      openToOtherTimes: data.openToOtherTimes ? 1 : 0,
      format: data.format,
      city: data.city,
      state: data.state,
      contactMethod: data.contactMethod,
      posterName: data.posterName,
      email: data.email,
      durationDays: data.durationDays,
      createdAt,
      expiresAt,
      status: "active"
    };

    try {
      insertPostRow(post);
    } catch (error) {
      // If production DB schema is older than code, attempt live repair once and retry.
      if (String(error?.message || "").includes("has no column named")) {
        ensurePostsSchema();
        insertPostRow(post);
      } else {
        throw error;
      }
    }

    const transporter = getTransporter();
    if (transporter) {
      try {
        await transporter.sendMail({
          from: process.env.RELAY_FROM_EMAIL || process.env.SMTP_USER,
          to: post.email,
          subject: "[Chavrusashaft] Your post is live",
          text: [
            "Your learning request is now active on Chavrusashaft.",
            "",
            `Topic: ${post.topic}`,
            `Active until: ${new Date(post.expiresAt).toLocaleDateString()}`,
            "",
            `Manage link: ${buildBaseUrl(req)}/manage/${post.manageToken}`
          ].join("\n")
        });
      } catch (error) {
        console.error("Post created but confirmation email failed:", error.message);
      }
    }

    return res.status(201).json({
      post: toPublicPost(post),
      manageUrl: `${buildBaseUrl(req)}/manage/${post.manageToken}`
    });
  } catch (error) {
    const details = error?.message || String(error);
    console.error("Create post failed:", details);
    return res.status(500).json({ error: "Could not create post." });
  }
});

app.post("/api/posts/:id/respond", async (req, res) => {
  if (!applyRateLimit(req, "respond-post", 20, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many responses. Try again later." });
  }

  const message = normalize(req.body.message);
  const responderTimeZone = normalize(req.body.timeZone);
  const responderAvailability = normalize(req.body.availability);
  const responderEmail = normalize(req.body.responderEmail);

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  if (!responderEmail) {
    return res.status(400).json({ error: "Your email is required for relay replies." });
  }

  try {
    syncExpiredPosts();

    const post = db
      .prepare("SELECT * FROM posts WHERE id = ? AND status = 'active' AND expiresAt > ?")
      .get(req.params.id, nowIso());

    if (!post) {
      return res.status(404).json({ error: "Post not found." });
    }

    const conversation = {
      id: randomToken(6),
      postId: post.id,
      createdAt: nowIso(),
      responderEmail,
      message,
      timeZone: responderTimeZone,
      availability: responderAvailability
    };

    db.prepare(
      `
      INSERT INTO conversations (
        id, postId, responderEmail, message, timeZone, availability, createdAt
      ) VALUES (
        @id, @postId, @responderEmail, @message, @timeZone, @availability, @createdAt
      )
    `
    ).run(conversation);

    const transporter = getTransporter();
    const subject = `[Chavrusashaft] New response to: ${post.topic}`;
    const body = [
      "You received a new response to your learning request.",
      "",
      `Category: ${post.category}`,
      `Topic: ${post.topic}`,
      "",
      "Message:",
      message,
      "",
      responderTimeZone ? `Responder time zone: ${responderTimeZone}` : "",
      responderAvailability ? `Responder availability: ${responderAvailability}` : "",
      "",
      `Manage your post: ${buildBaseUrl(req)}/manage/${post.manageToken}`
    ]
      .filter(Boolean)
      .join("\n");

    if (!post.email) {
      return res.json({
        ok: true,
        warning:
          "Message saved, but this post has no email address for notifications. Use the manage link to view responses."
      });
    }

    if (!transporter) {
      return res.json({
        ok: true,
        warning:
          "Message saved, but email relay is not configured yet. Set SMTP variables in Railway to enable notifications."
      });
    }

    try {
      await transporter.sendMail({
        from: process.env.RELAY_FROM_EMAIL || process.env.SMTP_USER,
        to: post.email,
        subject,
        text: body
      });
    } catch (error) {
      console.error("Response saved but relay email failed:", error.message);
      return res.json({
        ok: true,
        warning: "Message saved, but relay email delivery failed. Check SMTP settings."
      });
    }

    return res.json({ ok: true });
  } catch (_error) {
    return res.status(500).json({ error: "Could not send response." });
  }
});

app.get("/api/manage/:token", async (req, res) => {
  try {
    syncExpiredPosts();
    const data = getPostWithConversationsByToken(req.params.token);
    if (!data) {
      return res.status(404).json({ error: "Manage link not found." });
    }

    const { post, conversations } = data;
    return res.json({
      post: {
        id: post.id,
        postCode: `CB-${String(post.id || "").slice(0, 6).toUpperCase()}`,
        category: post.category,
        seferName: post.seferName,
        topic: post.topic,
        learningStyle: post.learningStyle,
        familiarityLevel: post.familiarityLevel,
        timeZone: post.timeZone,
        availabilityNotes: post.availabilityNotes,
        availabilitySlots: parseSlotsFromRow(post.availabilitySlots),
        openToOtherTimes: Boolean(post.openToOtherTimes),
        format: post.format,
        city: post.city,
        state: post.state,
        durationDays: post.durationDays,
        status: post.status,
        createdAt: post.createdAt,
        expiresAt: post.expiresAt,
        email: post.email,
        posterName: titleCaseWords(post.posterName),
        contactMethod: post.contactMethod
      },
      conversations
    });
  } catch (_error) {
    return res.status(500).json({ error: "Could not load manage page." });
  }
});

app.post("/api/manage/:token/update", async (req, res) => {
  const validated = validatePostPayload(req.body, { requireDuration: false });
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const post = db.prepare("SELECT id FROM posts WHERE manageToken = ?").get(req.params.token);
    if (!post) {
      return res.status(404).json({ error: "Manage link not found." });
    }

    const data = validated.value;
    db.prepare(
      `
      UPDATE posts
      SET
        category = @category,
        seferName = @seferName,
        topic = @topic,
        learningStyle = @learningStyle,
        familiarityLevel = @familiarityLevel,
        timeZone = @timeZone,
        availabilityNotes = @availabilityNotes,
        availabilitySlots = @availabilitySlots,
        openToOtherTimes = @openToOtherTimes,
        format = @format,
        city = @city,
        state = @state,
        email = @email,
        posterName = @posterName,
        contactMethod = 'relay'
      WHERE manageToken = @manageToken
    `
    ).run({
      category: data.category,
      seferName: data.seferName,
      topic: data.topic,
      learningStyle: data.learningStyle,
      familiarityLevel: data.familiarityLevel,
      timeZone: data.timeZone,
      availabilityNotes: data.availabilityNotes,
      availabilitySlots: JSON.stringify(data.availabilitySlots),
      openToOtherTimes: data.openToOtherTimes ? 1 : 0,
      format: data.format,
      city: data.city,
      state: data.state,
      email: data.email,
      posterName: data.posterName,
      manageToken: req.params.token
    });

    return res.json({ ok: true });
  } catch (_error) {
    return res.status(500).json({ error: "Could not update post." });
  }
});

app.post("/api/manage/:token/renew", async (req, res) => {
  const durationDays = Number(req.body.durationDays);
  if (!allowedDurations.has(durationDays)) {
    return res.status(400).json({ error: "Duration must be 7, 14, or 30 days." });
  }

  try {
    const post = db.prepare("SELECT id FROM posts WHERE manageToken = ?").get(req.params.token);
    if (!post) {
      return res.status(404).json({ error: "Manage link not found." });
    }

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `
      UPDATE posts
      SET durationDays = ?, expiresAt = ?, status = 'active'
      WHERE manageToken = ?
    `
    ).run(durationDays, expiresAt, req.params.token);

    return res.json({ ok: true, expiresAt });
  } catch (_error) {
    return res.status(500).json({ error: "Could not renew post." });
  }
});

app.post("/api/manage/:token/deactivate", async (req, res) => {
  try {
    const result = db
      .prepare("UPDATE posts SET status = 'inactive' WHERE manageToken = ?")
      .run(req.params.token);
    if (!result.changes) {
      return res.status(404).json({ error: "Manage link not found." });
    }
    return res.json({ ok: true });
  } catch (_error) {
    return res.status(500).json({ error: "Could not deactivate post." });
  }
});

app.post("/api/manage/:token/delete", async (req, res) => {
  try {
    const result = db.prepare("DELETE FROM posts WHERE manageToken = ?").run(req.params.token);
    if (!result.changes) {
      return res.status(404).json({ error: "Manage link not found." });
    }
    return res.json({ ok: true });
  } catch (_error) {
    return res.status(500).json({ error: "Could not delete post." });
  }
});

app.post("/api/admin/delete", async (req, res) => {
  const ownerDeleteKey = normalize(process.env.OWNER_DELETE_KEY);
  const providedKey = normalize(req.body.key);
  const postId = normalize(req.body.postId);

  if (!ownerDeleteKey) {
    return res.status(503).json({ error: "Owner delete key is not configured." });
  }
  if (!providedKey || providedKey !== ownerDeleteKey) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  if (!postId) {
    return res.status(400).json({ error: "Post id is required." });
  }

  try {
    const result = db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
    if (!result.changes) {
      return res.status(404).json({ error: "Post not found." });
    }
    return res.json({ ok: true });
  } catch (_error) {
    return res.status(500).json({ error: "Could not delete post." });
  }
});

app.post("/api/manage/:token/reply", async (req, res) => {
  const conversationId = normalize(req.body.conversationId);
  const message = normalize(req.body.message);

  if (!conversationId || !message) {
    return res.status(400).json({ error: "Conversation and message are required." });
  }

  try {
    const post = db.prepare("SELECT * FROM posts WHERE manageToken = ?").get(req.params.token);
    if (!post) {
      return res.status(404).json({ error: "Manage link not found." });
    }

    const conversation = db
      .prepare("SELECT * FROM conversations WHERE id = ? AND postId = ?")
      .get(conversationId, post.id);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    const transporter = getTransporter();
    if (!transporter) {
      return res.status(500).json({ error: "SMTP relay is not configured." });
    }

    await transporter.sendMail({
      from: process.env.RELAY_FROM_EMAIL || process.env.SMTP_USER,
      to: conversation.responderEmail,
      subject: `[Chavrusashaft] Reply about: ${post.topic}`,
      text: [
        "You received a reply from the post owner.",
        "",
        `Category: ${post.category}`,
        `Topic: ${post.topic}`,
        "",
        "Reply:",
        message,
        "",
        "If you want to share direct contact, include it in your next message."
      ].join("\n")
    });

    db.prepare("INSERT INTO replies (conversationId, message, createdAt) VALUES (?, ?, ?)").run(
      conversation.id,
      message,
      nowIso()
    );

    return res.json({ ok: true });
  } catch (_error) {
    return res.status(500).json({ error: "Could not send relay reply." });
  }
});

app.get("/post", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "post.html"));
});

app.get("/respond/:id", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "respond.html"));
});

app.get("/manage/:token", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "manage.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});
