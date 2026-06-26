require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const archiver = require("archiver");
const { scrapePage, downloadImages } = require("./app");
const { connect } = require("./db");
const { getPreviewVoucherNumbers, commitVoucherNumbers, getCounterNextNumber, setCounterNextNumber } = require("./voucherSequence");
const {
  ensureAuthIndexes,
  createUser,
  findUserByEmail,
  createSession,
  deleteSession,
  findUserFromToken,
  verifyPassword,
  sanitizeUser,
} = require("./auth");
const {
  ensureCareersIndexes,
  listCategories, createCategory, updateCategory, deleteCategory,
  listJobs, getJobBySlug, createJob, updateJob, deleteJob,
} = require("./careers");

const app = express();
const PORT = process.env.PORT || 3007;

function randomUniqueCode(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const ALLOWED_ORIGINS = [
  "https://infinite-utilities.vercel.app",
  "https://pacificgroups.in",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "images")));

app.get("/pdf/voucher.pdf", async (req, res) => {
  const pdfPath = path.join(__dirname, "pdf", "voucher.pdf");
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).send("Voucher PDF not found");
  }
  try {
    const bytes = fs.readFileSync(pdfPath);
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const VOUCHERS_PER_PAGE = 3;

    for (const page of pages) {
      const { height } = page.getSize();
      const third = height / 3;
      for (let i = 0; i < VOUCHERS_PER_PAGE; i++) {
        const code = randomUniqueCode(10);
        const y = height - 42 - i * third;
        page.drawText(code, {
          x: 120,
          y,
          size: 10,
          marginTop: 10,
          font,
          color: { type: "RGB", red: 0.2, green: 0.2, blue: 0.2 },
        });
      }
    }

    const pdfBytes = await doc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=voucher.pdf");
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("PDF voucher error:", err);
    res.status(500).send("Failed to generate voucher PDF");
  }
});

app.get("/vouchers", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "vouchers.html"));
});

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

async function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return next();

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const user = await findUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  req.authToken = token;
  req.user = user;
  return next();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Public careers endpoints (no auth required) ──────────────────────────────

app.get("/api/careers/categories", async (req, res) => {
  try {
    const categories = await listCategories();
    res.json({ categories });
  } catch (err) {
    console.error("List categories error:", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

app.get("/api/careers/jobs", async (req, res) => {
  try {
    const { categoryId, status } = req.query;
    const jobs = await listJobs({ categoryId, status });
    res.json({ jobs });
  } catch (err) {
    console.error("List jobs error:", err);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

app.get("/api/careers/jobs/:slug", async (req, res) => {
  try {
    const job = await getJobBySlug(req.params.slug);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ job });
  } catch (err) {
    console.error("Get job error:", err);
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.post("/api/auth/signup", async (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    const email = (req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password || "";

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: "Valid email is required" });
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ error: "Email already in use" });

    const user = await createUser({ name, email, password });
    const session = await createSession(user._id);
    return res.status(201).json({
      token: session.token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("Auth signup error:", err);
    return res.status(500).json({ error: "Failed to sign up" });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password || "";

    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const session = await createSession(user._id);
    return res.json({
      token: session.token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("Auth signin error:", err);
    return res.status(500).json({ error: "Failed to sign in" });
  }
});

app.use("/api", async (req, res, next) => {
  if (req.path === "/auth/signup" || req.path === "/auth/signin") {
    return next();
  }
  return requireAuth(req, res, next);
});

app.get("/api/auth/me", (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

app.post("/api/auth/signout", async (req, res) => {
  try {
    await deleteSession(req.authToken);
    return res.json({ success: true });
  } catch (err) {
    console.error("Auth signout error:", err);
    return res.status(500).json({ error: "Failed to sign out" });
  }
});

app.get("/api/voucher/next/preview", async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 1, 1), 100);
    const numbers = await getPreviewVoucherNumbers(count);
    res.json({ numbers });
  } catch (err) {
    console.error("Voucher preview error:", err);
    res.status(500).json({ error: "Failed to get voucher preview" });
  }
});

app.post("/api/voucher/commit", async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 1, 1), 100);
    const numbers = await commitVoucherNumbers(count);
    res.json({ numbers });
  } catch (err) {
    console.error("Voucher commit error:", err);
    res.status(500).json({ error: "Failed to save voucher numbers" });
  }
});

app.get("/api/voucher/counter", async (req, res) => {
  try {
    const nextNumber = await getCounterNextNumber();
    res.json({ nextNumber });
  } catch (err) {
    console.error("Voucher counter get error:", err);
    res.status(500).json({ error: "Failed to get counter" });
  }
});

app.put("/api/voucher/counter", async (req, res) => {
  try {
    const nextNumber = parseInt(req.body?.nextNumber, 10);
    if (Number.isNaN(nextNumber)) {
      return res.status(400).json({ error: "nextNumber is required and must be a number" });
    }
    const updated = await setCounterNextNumber(nextNumber);
    res.json({ nextNumber: updated });
  } catch (err) {
    console.error("Voucher counter set error:", err);
    res.status(400).json({ error: err.message || "Failed to update counter" });
  }
});

// ── Protected careers endpoints (auth required) ───────────────────────────────

app.post("/api/careers/categories", async (req, res) => {
  try {
    const { name, slug, order } = req.body;
    if (!name || !slug) return res.status(400).json({ error: "name and slug are required" });
    const cat = await createCategory({
      name: name.trim(),
      slug: slug.trim().toLowerCase().replace(/\s+/g, "-"),
      order: typeof order === "number" ? order : 0,
    });
    res.status(201).json({ category: cat });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Slug already exists" });
    console.error("Create category error:", err);
    res.status(500).json({ error: "Failed to create category" });
  }
});

app.put("/api/careers/categories/:id", async (req, res) => {
  try {
    const { name, slug, order } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (slug) updates.slug = slug.trim().toLowerCase().replace(/\s+/g, "-");
    if (typeof order === "number") updates.order = order;
    const cat = await updateCategory(req.params.id, updates);
    if (!cat) return res.status(404).json({ error: "Category not found" });
    res.json({ category: cat });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Slug already exists" });
    console.error("Update category error:", err);
    res.status(500).json({ error: "Failed to update category" });
  }
});

app.delete("/api/careers/categories/:id", async (req, res) => {
  try {
    const result = await deleteCategory(req.params.id);
    if (result.deletedCount === 0) return res.status(404).json({ error: "Category not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete category error:", err);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

app.post("/api/careers/jobs", async (req, res) => {
  try {
    const { title, slug } = req.body;
    if (!title || !slug) return res.status(400).json({ error: "title and slug are required" });
    const job = await createJob(req.body);
    res.status(201).json({ job });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Slug already exists" });
    console.error("Create job error:", err);
    res.status(500).json({ error: "Failed to create job" });
  }
});

app.put("/api/careers/jobs/:id", async (req, res) => {
  try {
    const job = await updateJob(req.params.id, req.body);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ job });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Slug already exists" });
    console.error("Update job error:", err);
    res.status(500).json({ error: "Failed to update job" });
  }
});

app.delete("/api/careers/jobs/:id", async (req, res) => {
  try {
    const result = await deleteJob(req.params.id);
    if (result.deletedCount === 0) return res.status(404).json({ error: "Job not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete job error:", err);
    res.status(500).json({ error: "Failed to delete job" });
  }
});

// ── Scraper ───────────────────────────────────────────────────────────────────

app.post("/api/scrape", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }

  let tempDir;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Invalid URL" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  tempDir = path.join(__dirname, "temp", `scrape-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  try {
    const imageUrls = await scrapePage(url);
    if (imageUrls.length === 0) {
      return res.status(404).json({ error: "No product images found on this page" });
    }

    await downloadImages(imageUrls, tempDir);

    let cleaned = false;
    function cleanupTemp() {
      if (cleaned) return;
      cleaned = true;
      try {
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.error("Cleanup error:", e);
      }
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="product-images.zip"');

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      cleanupTemp();
      if (!res.headersSent) res.status(500).json({ error: "Zip failed" });
    });
    res.on("finish", cleanupTemp);
    res.on("close", cleanupTemp);

    archive.pipe(res);
    archive.directory(tempDir, false);
    await archive.finalize();
  } catch (err) {
    if (typeof tempDir !== "undefined" && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    console.error(err);
    res.status(500).json({ error: err.message || "Scraping failed" });
  }
});

connect()
  .then(() => Promise.all([ensureAuthIndexes(), ensureCareersIndexes()]))
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB connect failed:", err);
    process.exit(1);
  });
