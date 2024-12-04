/* the13thgeek: GEEKHUB ROUTING */

const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
require('dotenv').config();

// Shared DB connection pool
const dbPool = mysql.createPool({
    host: process.env.GEEKHUB_DB_ENDPOINT,
    user: process.env.GEEKHUB_DB_USER,
    password: process.env.GEEKHUB_DB_PASS,
    database: process.env.GEEKHUB_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

// Internal functions
async function test() {
    console.log('TEST activated.');
    let rows = null;
    try {
        const conn = await dbPool.getConnection();
        console.log('DB pool connected.');

        const [result] = await conn.execute("SELECT * FROM tbl_users WHERE is_active = 1");
        rows = result;

        console.log('Output: ');
        console.log(JSON.stringify(rows, null, 2));

        await conn.release();
    } catch (e) {
        console.error(e.message)
    }
    return rows;
}

// Endpoint for testing
router.post('/test', async (req, res) => {
    const data = await test();
    res.status(200).json(data);
});

module.exports = router;