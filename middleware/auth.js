const jwt = require("jsonwebtoken");
const JWT_SECRET = "secret_key_yang_aman_dan_unik";

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token tidak tersedia" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error("ERROR VERIFIKASI TOKEN:", err.message);
      return res.status(403).json({ error: "Token tidak valid" });
    }
    req.user = user;
    next();
  });
};

module.exports = { authenticateToken, JWT_SECRET };