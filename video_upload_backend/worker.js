const db = require("./db");
const { generateCinematicHighlight } = require("./controllers/jobController");
const path = require("path");

async function processJob(job) {
  try {
    db.prepare(`UPDATE jobs SET status=? WHERE id=?`).run("processing", job.id);

    const input = JSON.parse(job.inputFiles)[0];
    const highlightOut = path.join(job.uploadDir, "highlight.mp4");

    const highlight = await generateCinematicHighlight(input, highlightOut);

    const result = { highlight };

    db.prepare(`UPDATE jobs SET status=?, result=? WHERE id=?`)
      .run("done", JSON.stringify(result), job.id);

    console.log(`✅ Job ${job.id} done`);
  } catch (err) {
    db.prepare(`UPDATE jobs SET status=?, error=? WHERE id=?`)
      .run("failed", err.message, job.id);
    console.error(`❌ Job ${job.id} failed:`, err.message);
  }
}

async function runWorker() {
  while (true) {
    const job = db.prepare(`SELECT * FROM jobs WHERE status='queued' LIMIT 1`).get();
    if (job) {
      await processJob(job);
    } else {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

runWorker();
