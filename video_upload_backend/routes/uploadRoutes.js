const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMiddleware");
const { uploadVideo } = require("../controllers/uploadController");

// POST /api/videos/upload
router.post("/upload", upload.single("file"), uploadVideo);

module.exports = router;
