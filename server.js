require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const archiver = require("archiver");
const { scrapePage, downloadImages } = require("./app");
const { connect } = require("./db");
const { getPreviewVoucherNumbers, commitVoucherNumbers } = require("./voucherSequence");

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
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB connect failed:", err);
    process.exit(1);
  });
