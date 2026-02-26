const { MongoClient } = require("mongodb");

const uri = process.env.Mongo_URI || process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGO_DB_NAME || "pacific_utilities";

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  return db;
}

function getDb() {
  if (!db) throw new Error("DB not connected. Call connect() first.");
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { connect, getDb, close };
