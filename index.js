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
const allJournals = csv.parse(rawData, {
  columns: true,
  skip_empty_lines: true,
});

//const allJournals = _allJournals.slice(0, 20);

const errors = [];
const corrections = [];

// Tested selector
//document.querySelector("h1.page_title")
//document.querySelector(".entry_details .item.published .value")
//Array.from(document.querySelector(".item.authors").querySelectorAll(".name")).map(d => d.innerText)

const selectors = [
  "h1.page_title",
  ".entry_details .item.published .value",
  ".item.authors",
];

(async function () {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  for (const journal of allJournals) {
    console.log(`[JOB] processing journal number ${journal.No}`);

    try {
      await page.goto(journal.Link_Bukti_Luaran);
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

    try {
      for (const selector of selectors) await page.waitForSelector(selector);

      console.log("Selector all checked 👻");
    } catch (e) {
      errors.push({
        number: journal.No,
        reason: "Can't reach for the selector",
        error: e,
      });

      console.log(`[ERROR ${journal.No}] Can't reach for the selector`);
      console.log("============================================");
      console.log();

      continue;
    }

    const title = await page.$eval("h1.page_title", (el) => el.innerText);
    const publishedDate = await page.$eval(
      ".entry_details .item.published .value",
      (el) => el.innerText,
    );
    const authors = await page.$eval(".item.authors", (el) =>
      [...el.querySelectorAll(".name")].map((d) => d.innerText),
    );

    // theoritically student is the first writer;
    const firstAuthor = authors[0];

    // Should be YYYY-MM-DD
    const publishedYear = publishedDate
      .split("-")
      .sort((a, b) => b.length - a.length)[0];

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

      continue;
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
      `[NOT PASSED] Journal number ${journal.No} has mismatch! Please check on the full report at the end.`,
    );
    console.log(`Correction message: ${correctionMessage.join(" ")}`);
    console.log("============================================");
    console.log();
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
        })}\nKoreksi: ${c.correctionMessage}\nData benar: ${JSON.stringify(c.dataShouldBe, null, 2)}`;
      })
      .join("\n\n")}`,
  );

  fs.writeFileSync(
    "./result/errors.txt",
    `Berikut ini pengecekan yang error, mohon periksa secara manual.\n\n\n${errors.map((e) => `Nomor ${e.number}, Reason: ${e.reason}`).join("\n")}`,
  );

  console.log("done.");
})();
