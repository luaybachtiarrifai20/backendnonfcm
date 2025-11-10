const mysql = require("mysql2/promise");
require("dotenv").config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
};

async function getConnection() {
  try {
    console.log("Mencoba menghubungkan ke database...");
    const connection = await mysql.createConnection(dbConfig);
    console.log("Berhasil terhubung ke database MySQL");
    return connection;
  } catch (error) {
    console.error("ERROR KONEKSI DATABASE:", error.message);
    console.error("Kode error:", error.code);
    console.error("Detail error:", error);
    throw error;
  }
}

module.exports = { getConnection, dbConfig };