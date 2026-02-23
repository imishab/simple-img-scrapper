const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

async function scrapePage(website) {
  const { data } = await axios.get(website);
  const $ = cheerio.load(data);
  const baseUrl = new URL(website).origin;
  const imageUrls = [];

  $("img").each((i, el) => {
    let imgUrl = $(el).attr("src");
    if (imgUrl && imgUrl.includes("product")) {
      if (imgUrl.startsWith("/")) {
        imgUrl = baseUrl + imgUrl;
      }
      imageUrls.push(imgUrl);
    }
  });

  return imageUrls;
}

async function downloadImage(url, folder, index) {
  const ext = path.extname(new URL(url).pathname) || ".png";
  const fileName = `${index}${ext}`;
  const filePath = path.join(folder, fileName);

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  const writeStream = fs.createWriteStream(filePath);
  response.data.pipe(writeStream);
  return new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    response.data.on("error", reject);
  });
}

async function downloadImages(imageUrls, folder) {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  await Promise.all(
    imageUrls.map((url, i) => downloadImage(url, folder, i + 1))
  );
}

module.exports = { scrapePage, downloadImages };
