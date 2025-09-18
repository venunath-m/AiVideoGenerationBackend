const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const db = require("../db");
const {
    generateCinematicHighlight: cinematicHighlight,
} = require("./uploadController"); // use full-featured one
const { ensureDirExists } = require("./uploadController");

// Create a job when videos are uploaded
exports.createJob = (req, res) => {
    const jobId = `job_${uuidv4()}`;
    const uploadDir = path.join(__dirname, "..", "uploads", jobId);
    ensureDirExists(uploadDir);

    const files = req.files;
    if (!files || !files.length) return res.status(400).json({ error: "No files uploaded" });

    const inputFiles = files.map(f => {
        const dest = path.join(uploadDir, f.originalname);
        fs.renameSync(f.path, dest);
        return dest;
    });

    db.prepare(`
        INSERT INTO jobs (id, status, inputFiles, uploadDir, createdAt)
        VALUES (?, ?, ?, ?, ?)
    `).run(jobId, "queued", JSON.stringify(inputFiles), uploadDir, Date.now());

    req.app.get("io")?.emit("jobQueued", { jobId });

    res.json({ jobId, status: "queued" });
};

// Worker processor
async function processJob(job) {
    try {
        db.prepare(`UPDATE jobs SET status=? WHERE id=?`).run("processing", job.id);

        const inputFiles = JSON.parse(job.inputFiles);
        // Process each video sequentially, or merge first
        const firstInput = inputFiles[0];
        const highlightOut = path.join(job.uploadDir, `highlight_${Date.now()}.mp4`);

        const highlight = await cinematicHighlight(firstInput, highlightOut);

        const result = { highlight: `/uploads/${path.basename(highlight)}` };

        db.prepare(`UPDATE jobs SET status=?, result=? WHERE id=?`)
          .run("done", JSON.stringify(result), job.id);

        console.log(`✅ Job ${job.id} done`);
    } catch (err) {
        db.prepare(`UPDATE jobs SET status=?, error=? WHERE id=?`)
          .run("failed", err.message, job.id);
        console.error(`❌ Job ${job.id} failed:`, err.message);
    }
}

// Run worker loop
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

module.exports = { createJob };
