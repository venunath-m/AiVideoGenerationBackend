const express = require("express");
const router = express.Router();
const { extractEvents } = require("../controllers/eventController");

// POST /api/videos/extract-events
router.post("/extract-events", extractEvents);

module.exports = router;
