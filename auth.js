const crypto = require("crypto");
const { getDb } = require("./db");

const USERS_COLLECTION = "users";
const SESSIONS_COLLECTION = "auth_sessions";
const SESSION_DAYS = parseInt(process.env.AUTH_SESSION_DAYS || "30", 10);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [salt, savedKey] = (storedHash || "").split(":");
  if (!salt || !savedKey) return false;

  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  const savedBuffer = Buffer.from(savedKey, "hex");
  const actualBuffer = Buffer.from(derivedKey, "hex");
  if (savedBuffer.length !== actualBuffer.length) return false;

  return crypto.timingSafeEqual(savedBuffer, actualBuffer);
}

function sanitizeUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function ensureAuthIndexes() {
  const db = getDb();
  await db.collection(USERS_COLLECTION).createIndex({ email: 1 }, { unique: true });
  await db.collection(SESSIONS_COLLECTION).createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection(SESSIONS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

async function createUser({ name, email, password }) {
  const db = getDb();
  const now = new Date();

  const doc = {
    name,
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection(USERS_COLLECTION).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function findUserByEmail(email) {
  const db = getDb();
  return db.collection(USERS_COLLECTION).findOne({ email: email.toLowerCase() });
}

async function createSession(userId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.collection(SESSIONS_COLLECTION).insertOne({
    userId,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt,
  });

  return { token, expiresAt };
}

async function deleteSession(token) {
  const db = getDb();
  const tokenHash = hashToken(token);
  await db.collection(SESSIONS_COLLECTION).deleteOne({ tokenHash });
}

async function findUserFromToken(token) {
  const db = getDb();
  const tokenHash = hashToken(token);
  const now = new Date();

  const session = await db
    .collection(SESSIONS_COLLECTION)
    .findOne({ tokenHash, expiresAt: { $gt: now } });

  if (!session) return null;

  const user = await db.collection(USERS_COLLECTION).findOne({ _id: session.userId });
  if (!user) {
    await db.collection(SESSIONS_COLLECTION).deleteOne({ _id: session._id });
    return null;
  }

  return user;
}

module.exports = {
  ensureAuthIndexes,
  createUser,
  findUserByEmail,
  createSession,
  deleteSession,
  findUserFromToken,
  verifyPassword,
  sanitizeUser,
};
