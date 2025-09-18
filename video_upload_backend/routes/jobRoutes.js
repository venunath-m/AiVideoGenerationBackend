const express = require("express");
const router = express.Router();
const db = require("../db");
const { createJob } = require("../controllers/jobController");
const multer = require("multer");

const upload = multer({ dest: "temp/" });

router.post("/upload", upload.array("videos"), createJob);

router.get("/:id", (req, res) => {
    const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    res.json({
        id: job.id,
        status: job.status,
        result: job.result ? JSON.parse(job.result) : null,
        error: job.error || null
    });
});

module.exports = router;
