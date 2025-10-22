const mysql = require("mysql2");

const dbLocal = mysql.createConnection({
  host: process.env.DB_HOST || "db",  // 👈 este usa el servicio de docker-compose
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "joseumgfelipeing",
  database: process.env.DB_NAME || "db_faceapi",
  port: 3306,
  multipleStatements: true
});

dbLocal.connect((err) => {
  if (err) {
    console.error("❌ Error conectando con analizador_db:", err.message);
  } else {
    console.log("✅ Conectado a la base de datos local (Docker).");
  }
});

module.exports = dbLocal;
