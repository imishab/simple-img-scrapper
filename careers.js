const { getDb } = require('./db');
const { ObjectId } = require('mongodb');

const CATEGORIES_COL = 'job_categories';
const JOBS_COL = 'job_posts';
const APPLICATIONS_COL = 'job_applications';

async function ensureCareersIndexes() {
  const db = getDb();
  await Promise.all([
    db.collection(CATEGORIES_COL).createIndex({ slug: 1 }, { unique: true }),
    db.collection(JOBS_COL).createIndex({ slug: 1 }, { unique: true }),
    db.collection(JOBS_COL).createIndex({ categoryId: 1 }),
    db.collection(JOBS_COL).createIndex({ status: 1 }),
    db.collection(APPLICATIONS_COL).createIndex({ jobSlug: 1 }),
    db.collection(APPLICATIONS_COL).createIndex({ submittedAt: -1 }),
  ]);
}

function toObjectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    throw new Error('Invalid ID format');
  }
}

// --- Categories ---

async function listCategories() {
  const db = getDb();
  return db.collection(CATEGORIES_COL).find({}).sort({ order: 1, name: 1 }).toArray();
}

async function createCategory({ name, slug, order = 0 }) {
  const db = getDb();
  const now = new Date();
  const doc = { name, slug, order, createdAt: now, updatedAt: now };
  const result = await db.collection(CATEGORIES_COL).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function updateCategory(id, updates) {
  const db = getDb();
  const now = new Date();
  const result = await db.collection(CATEGORIES_COL).findOneAndUpdate(
    { _id: toObjectId(id) },
    { $set: { ...updates, updatedAt: now } },
    { returnDocument: 'after' }
  );
  return result;
}

async function deleteCategory(id) {
  const db = getDb();
  return db.collection(CATEGORIES_COL).deleteOne({ _id: toObjectId(id) });
}

// --- Jobs ---

async function listJobs({ categoryId, status } = {}) {
  const db = getDb();
  const filter = {};
  if (categoryId) {
    try { filter.categoryId = toObjectId(categoryId); } catch { /* ignore invalid id */ }
  }
  if (status) filter.status = status;
  return db.collection(JOBS_COL).find(filter).sort({ createdAt: -1 }).toArray();
}

async function getJobBySlug(slug) {
  const db = getDb();
  return db.collection(JOBS_COL).findOne({ slug });
}

async function getJobById(id) {
  const db = getDb();
  return db.collection(JOBS_COL).findOne({ _id: toObjectId(id) });
}

function sanitizeJobInput(data) {
  const job = { ...data };
  if (job.categoryId) {
    try { job.categoryId = toObjectId(job.categoryId); } catch { delete job.categoryId; }
  }
  // Ensure array fields are arrays
  for (const field of ['responsibilities', 'sales', 'qualifications', 'preferred', 'meta']) {
    if (job[field] !== undefined && !Array.isArray(job[field])) {
      delete job[field];
    }
  }
  // Strip _id from input to avoid conflicts
  delete job._id;
  return job;
}

async function createJob(data) {
  const db = getDb();
  const now = new Date();
  const doc = { ...sanitizeJobInput(data), createdAt: now, updatedAt: now };
  const result = await db.collection(JOBS_COL).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function updateJob(id, data) {
  const db = getDb();
  const now = new Date();
  const result = await db.collection(JOBS_COL).findOneAndUpdate(
    { _id: toObjectId(id) },
    { $set: { ...sanitizeJobInput(data), updatedAt: now } },
    { returnDocument: 'after' }
  );
  return result;
}

async function deleteJob(id) {
  const db = getDb();
  return db.collection(JOBS_COL).deleteOne({ _id: toObjectId(id) });
}

// --- Applications ---

async function createApplication(data) {
  const db = getDb();
  const doc = { ...data, submittedAt: new Date() };
  const result = await db.collection(APPLICATIONS_COL).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function listApplications({ jobSlug } = {}) {
  const db = getDb();
  const filter = {};
  if (jobSlug) filter.jobSlug = jobSlug;
  return db.collection(APPLICATIONS_COL).find(filter).sort({ submittedAt: -1 }).toArray();
}

async function getApplicationById(id) {
  const db = getDb();
  return db.collection(APPLICATIONS_COL).findOne({ _id: toObjectId(id) });
}

module.exports = {
  ensureCareersIndexes,
  listCategories, createCategory, updateCategory, deleteCategory,
  listJobs, getJobBySlug, getJobById, createJob, updateJob, deleteJob,
  createApplication, listApplications, getApplicationById,
};
