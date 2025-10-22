const mysql = require("mysql2");

const dbCentral = mysql.createPool({
  host: "66.70.255.24",      // 🔹 remoto (fuera del contenedor)
  user: "Grupo4",
  password: "ProyectoAut25",
  database: "sistema_autenticacion",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,        // máximo de conexiones simultáneas
  queueLimit: 0,
  multipleStatements: true,
  connectTimeout: 15000
});

dbCentral.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Error conectando con la BD centralizada:", err.message);
  } else {
    console.log("✅ Conectado a la base de datos central del sistema de autenticación.");
    connection.release(); // libera la conexión de prueba
  }
});

module.exports = dbCentral;
