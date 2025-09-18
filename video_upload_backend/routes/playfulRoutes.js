const express = require("express");
const router = express.Router();
const { generatePlayfulVideo } = require("../controllers/playfulController");

router.post("/playful", generatePlayfulVideo);

module.exports = router;
