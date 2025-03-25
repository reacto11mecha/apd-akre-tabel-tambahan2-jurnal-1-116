const puppeteer = require("puppeteer");
const csv = require("csv/sync");
const fs = require("fs");

if (!fs.existsSync("result/")) fs.mkdirSync("result/");

const rawData = fs.readFileSync("./data.csv", "utf8");

/**
 *
 * Expected data type
 * {
 *    No: string
 *    Judul_Luaran: string
 *    Mahasiswa_yang_Terlibat: string
 *    Jenis_Luaran: string
 *    Link_Bukti_Luaran: string
 *  }[]
 *
 */
const _allJournals = csv.parse(rawData, {
  columns: true,
  skip_empty_lines: true,
});

// const allJournals = _allJournals
//const allJournals = _allJournals.slice(0, 20);

const onlyScrapeThis = [
  27, 29, 33, 34, 35, 57, 69, 71, 76, 77, 79, 82, 83, 85, 89, 91, 93, 107, 109,
  110, 111, 113, 115, 116,
];
const allJournals = _allJournals.filter((j) =>
  onlyScrapeThis.includes(parseInt(j.No))
);

const errors = [];
const corrections = [];

const methods = [
  {
    selectors: [
      "h1.page_title",
      ".entry_details .item.published .value",
      ".item.authors",
    ],
    cb: async (page) => {
      const title = await page.$eval("h1.page_title", (el) => el.innerText);
      const publishedDate = await page.$eval(
        ".entry_details .item.published .value",
        (el) => el.innerText
      );
      const authors = await page.$eval(".item.authors", (el) =>
        [...el.querySelectorAll(".name")].map((d) => d.innerText)
      );

      const firstAuthor = authors[0];

      const publishedYear = publishedDate
        .split(/[-\/]/)
        .sort((a, b) => b.length - a.length)[0];

      return {
        title,
        firstAuthor,
        publishedYear,
      };
    },
  },
  {
    selectors: ["h1.page-header", ".author strong", ".date-published"],
    cb: async (page) => {
      const title = await page.$eval("h1.page-header", (el) => el.innerText);
      const firstAuthor = await page.$eval(
        ".author strong",
        (el) => el.innerText
      );
      const datePublished = await page.$eval(
        ".date-published",
        (el) => el.innerText
      );

      const publishedYear = await (async () => {
        if (datePublished.includes(","))
          return datePublished.split(", ")[1].trim();

        const tryAgain = await page.$eval(
          ".date-published:nth-of-type(2)",
          (el) => el.innerText
        );

        return tryAgain.split(", ")[1].trim();
      })();

      return {
        title,
        firstAuthor,
        publishedYear,
      };
    },
  },
  {
    selectors: [
      ".author-detail .author-name",
      "h3.banner-subtitle-article",
      ".date-published",
    ],
    cb: async (page) => {
      const title = await page.$eval(
        "h3.banner-subtitle-article",
        (el) => el.innerText
      );
      const firstAuthor = await page.$eval(
        ".author-detail .author-name",
        (el) => el.innerText
      );
      const datePublished = await page.$eval(
        ".date-published",
        (el) => el.innerText
      );

      const publishedYear = datePublished.split(", ")[1].trim();

      return {
        title,
        firstAuthor,
        publishedYear,
      };
    },
  },
];

const ignoreList = [
  // dari correction
  2, 14, 26, 46, 53, 58, 63, 68, 72, 73, 75, 88, 101, 102,

  // dari si error
  5, 16, 21, 22, 23,
];

(async function () {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  for (const journal of allJournals) {
    if (ignoreList.includes(parseInt(journal.No))) continue;

    console.log("============================================");
    console.log(`[JOB] processing journal number ${journal.No}`);

    try {
      await page.goto(journal.Link_Bukti_Luaran, {
        waitUntil: "load",
        timeout: 30_000,
      });
    } catch (e) {
      errors.push({
        number: journal.No,
        reason: "Can't open the journal",
        error: e,
      });

      console.log(`[ERROR ${journal.No}] Can't open the journal`);
      console.log("============================================");
      console.log();

      continue;
    }

    let alreadyExit = false;

    for (const [idx, method] of methods.entries()) {
      if (alreadyExit) break;

      try {
        console.log(`[METHOD] Trying method ${idx + 1}`);

        for (const selector of method.selectors)
          await page.waitForSelector(selector, { timeout: 3_500 });
      } catch (e) {
        if (idx !== methods.length - 1) {
          console.log(`[METHOD] Switching to method ${idx + 2}`);

          continue;
        }

        errors.push({
          number: journal.No,
          reason: "Can't reach for the selector",
          error: e,
        });

        console.log(`[ERROR ${journal.No}] Can't pick the right selector`);
        console.log("============================================");
        console.log();

        alreadyExit = true;
        break;
      }

      console.log("Selector all checked 👻");

      const { title, firstAuthor, publishedYear } = await method.cb(page);

      const correctionMessage = [];

      if (journal.Judul_Luaran.trim() !== title.trim())
        correctionMessage.push("Judul tidak sama.");

      if (journal.Tahun.trim() !== publishedYear.trim())
        correctionMessage.push("Tahun tidak sama.");

      if (journal.Mahasiswa_yang_Terlibat.trim() !== firstAuthor)
        correctionMessage.push("Nama mahasiswa yang terlibat tidak sama");

      if (correctionMessage.length < 1) {
        console.log(`[PASSED] Journal number ${journal.No} match!`);
        console.log("============================================");
        console.log();

        // Exit from the method iteration
        alreadyExit = true;
        break;
      }

      corrections.push({
        number: journal.No,
        correctionMessage: correctionMessage.join(" "),
        dataShouldBe: {
          Judul_Luaran: title.trim(),
          Tahun: publishedYear.trim(),
          Mahasiswa_yang_Terlibat: firstAuthor.trim(),
        },
      });

      console.log(
        `[NOT PASSED] Journal number ${journal.No} has mismatch! Please check on the full report at the end.`
      );
      console.log(`Correction message: ${correctionMessage.join(" ")}`);
      console.log("============================================");
      console.log();

      // Exit from the method iteration
      alreadyExit = true;
      break;
    }
  }

  await browser.close();

  console.log("GENERATING REPORT.....");

  fs.writeFileSync(
    "./result/corrections.txt",
    `Mohon perbaiki secara manual berdasarkan laporan dibawah ini.\n\n\n${corrections
      .map((c) => {
        const journal = allJournals.find((j) => j.No === c.number);

        return `NOMOR: ${c.number}\nData asli: ${JSON.stringify({
          Judul_Luaran: journal.Judul_Luaran,
          Tahun: journal.Tahun,
          Mahasiswa_yang_Terlibat: journal.Mahasiswa_yang_Terlibat,
        })}\nKoreksi: ${c.correctionMessage}\nData benar: ${JSON.stringify(
          c.dataShouldBe,
          null,
          2
        )}`;
      })
      .join("\n\n")}`
  );

  fs.writeFileSync(
    "./result/errors.txt",
    `Berikut ini pengecekan yang error, mohon periksa secara manual.\n\n\n${errors
      .map((e) => `Nomor ${e.number}, Reason: ${e.reason}`)
      .join("\n")}`
  );

  console.log("done.");
})();
