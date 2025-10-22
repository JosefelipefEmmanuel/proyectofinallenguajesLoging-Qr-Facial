const mysql = require("mysql2");

const dbCentral = mysql.createConnection({
  host: "66.70.255.24",      // 🔹 remoto (no dentro del contenedor)
  user: "Grupo4",
  password: "ProyectoAut25",
  database: "sistema_autenticacion",
  port: 3306,
  multipleStatements: true,
  connectTimeout: 15000
});

dbCentral.connect((err) => {
  if (err) {
    console.error("❌ Error conectando con la BD centralizada:", err.message);
  } else {
    console.log("✅ Conectado a la base de datos central del sistema de autenticación.");
  }
});

module.exports = dbCentral;
