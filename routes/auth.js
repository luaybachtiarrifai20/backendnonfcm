const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { comparePassword } = require("../utils/helpers");
const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");

// Login
router.post("/login", async (req, res) => {
  try {
    console.log("Login attempt:", req.body.email);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email dan password diperlukan" });
    }

    const connection = await getConnection();

    const [users] = await connection.execute(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    await connection.end();

    if (users.length === 0) {
      console.log("Login gagal: Email tidak ditemukan");
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const user = users[0];
    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      console.log("Login gagal: Password salah");
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log("Login berhasil untuk user:", user.email);
    res.json({
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        role: user.role,
        kelas_id: user.kelas_id,
      },
    });
  } catch (error) {
    console.error("ERROR LOGIN:", error.message);
    res.status(500).json({ error: "Terjadi kesalahan server saat login" });
  }
});

module.exports = router;