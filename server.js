const express = require("express");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const { scrapePage, downloadImages } = require("./app");

const app = express();
const PORT =  3007;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "images")));

app.get("/vouchers", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "vouchers.html"));
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
