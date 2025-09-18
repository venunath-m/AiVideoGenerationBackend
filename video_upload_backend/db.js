const Database = require("better-sqlite3");
const db = new Database("jobs.db");

db.prepare(`
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT,
        inputFiles TEXT,
        uploadDir TEXT,
        result TEXT,
        error TEXT,
        createdAt INTEGER
    )
`).run();

module.exports = db;
