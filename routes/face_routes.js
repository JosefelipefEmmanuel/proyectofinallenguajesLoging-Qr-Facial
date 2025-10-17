const express = require("express");
const path = require("path");
const db = require("../database");
const multer = require("multer");

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Servir modelos FaceAPI
router.use("/models", express.static(path.join(__dirname, "../public/models")));

// Obtener etiquetas (nombres de usuarios con imagen)
router.get("/get-labels", (req, res) => {
  const empresaId = req.query.empresaId;
  if (!empresaId) return res.status(400).json({ error: "empresaId requerido" });

  const sql = "SELECT nombre FROM tabla_usuarios WHERE codigo_empresa = ? AND imagen IS NOT NULL";
  db.query(sql, [empresaId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error en la base de datos" });
    const labels = rows.map(r => r.nombre);
    res.json({ labels });
  });
});

// Obtener imagen de usuario
router.get("/get-image", (req, res) => {
  const { name, empresaId } = req.query;
  if (!name || !empresaId) return res.status(400).send("Faltan parámetros");
  const sql = "SELECT imagen FROM tabla_usuarios WHERE nombre = ? AND codigo_empresa = ? LIMIT 1";
  db.query(sql, [name, empresaId], (err, result) => {
    if (err || result.length === 0) return res.status(404).send("No encontrada");
    res.setHeader("Content-Type", "image/jpeg");
    res.send(result[0].imagen);
  });
});

// Obtener ID del usuario
router.get("/get-user-id", (req, res) => {
  const { name, empresaId } = req.query;
  const sql = "SELECT id FROM tabla_usuarios WHERE nombre = ? AND codigo_empresa = ?";
  db.query(sql, [name, empresaId], (err, result) => {
    if (err || result.length === 0) return res.status(404).send("Usuario no encontrado");
    res.json({ id: result[0].id });
  });
});

// Registrar entrada facial
router.post("/register-entry", (req, res) => {
  const { usuarioId, empresaId, deviceCode, resultado_autenticacion } = req.body;
  if (!usuarioId || !empresaId)
    return res.status(400).send("Datos incompletos en la solicitud");

  const sql = `
    INSERT INTO registro_accesos (usuario_id, empresa_id, device_code, resultado, fecha_hora)
    VALUES (?, ?, ?, ?, NOW())
  `;
  db.query(sql, [usuarioId, empresaId, deviceCode, resultado_autenticacion || "Exitosa"], (err) => {
    if (err) return res.status(500).send("Error al registrar entrada");
    res.send("Entrada registrada exitosamente");
  });
});

// Registrar intento fallido
router.post("/register-failed-attempt", upload.none(), (req, res) => {
  const { nombre, empresaId, motivo } = req.body;
  const sql = `
    INSERT INTO intentos_fallidos (nombre, empresa_id, motivo, fecha_hora)
    VALUES (?, ?, ?, NOW())
  `;
  db.query(sql, [nombre || "Desconocido", empresaId, motivo || "Desconocido"], (err) => {
    if (err) return res.status(500).send("Error al registrar intento fallido");
    res.send("Intento fallido registrado");
  });
});

module.exports = router;
