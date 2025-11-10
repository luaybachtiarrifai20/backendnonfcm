const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Konfigurasi storage untuk RPP
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/rpp");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log("Created upload directory:", uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const originalName = file.originalname;
    const cleanName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const fileName = `${timestamp}-${cleanName}`;
    console.log("Generated filename:", fileName);
    cb(null, fileName);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: function (req, file, cb) {
    console.log("File filter checking:", file.mimetype, file.originalname);

    const allowedTypes = [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
    ];

    const allowedExtensions = [".pdf", ".doc", ".docx"];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      console.log("File type rejected:", file.mimetype, fileExtension);
      cb(
        new Error("Hanya file Word (.doc, .docx) dan PDF yang diizinkan"),
        false
      );
    }
  },
});

// Konfigurasi untuk Excel (memory storage)
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
    ];

    const allowedExtensions = [".xls", ".xlsx", ".ods"];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file Excel (.xls, .xlsx) yang diizinkan"), false);
    }
  },
});

// Middleware wrapper untuk error handling
const uploadMiddleware = (req, res, next) => {
  upload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error("Multer Error:", err);
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      console.error("Unknown Upload Error:", err);
      return res.status(500).json({
        error: `Upload failed: ${err.message}`,
      });
    }
    next();
  });
};

const excelUploadMiddleware = (req, res, next) => {
  excelUpload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error("Multer Error:", err);
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      console.error("Unknown Upload Error:", err);
      return res.status(500).json({
        error: `Upload failed: ${err.message}`,
      });
    }
    next();
  });
};

module.exports = {
  uploadMiddleware,
  excelUploadMiddleware,
  upload,
  excelUpload
};