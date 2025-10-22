//server

// ============================
// server.js — versión PRO optimizada con FaceAPI + PDF + QR + Correo + WhatsApp
// ============================
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const db = require("./database");
// ============================
// 💾 CONEXIÓN SECUNDARIA — BASE LOCAL analizador_db
// ============================
const mysql = require("mysql2");
const dbAnalisis = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "josesitolqls", // tu clave local
  database: "analizador_db"
});

dbAnalisis.connect((err) => {
  if (err) {
    console.error("❌ Error conectando con analizador_db:", err.message);
  } else {
    console.log("✅ Conectado exitosamente a la base de datos local analizador_db.");
  }
});

const { Canvas, Image, ImageData, createCanvas, loadImage } = require("canvas");
const faceapi = require("face-api.js");
const Jimp = require("jimp");
const axios = require("axios");
const { spawn } = require("child_process");


// ============================
// ⚙️ Express + Configuración base
// ============================
const app = express();
const port = 3000;


const faceRoutes = require("./routes/face_routes");
app.use("/", faceRoutes);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================
// 🧠 Cargar modelos FaceAPI
// ============================
const MODEL_PATH = path.join(__dirname, "models");
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
Promise.all([
  faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH),
  faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
  faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH),
  faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_PATH),
]).then(() => console.log("✅ Modelos de FaceAPI cargados correctamente."));

// ============================
// 🏠 Página principal
// ============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

// ============================
// 📩 Registrar usuario (usa fn_encriptar_password en la BD)
// ============================
app.post("/api/registrar", upload.single("photo"), async (req, res) => {
  try {
    const { nombre1, nombre2, nombre3, apellido1, apellido2, correo, telefono, cedula, filtro, password } = req.body;
    let fotoPath = null;
    if (req.file && req.file.path) {
      fotoPath = path.resolve(__dirname, req.file.path);
      console.log("📁 Foto subida correctamente:", fotoPath);
    } else {
      console.warn("⚠️ No se recibió archivo de foto en la solicitud.");
    }

    const codigoQR = `UMG-QR-${Math.floor(100000 + Math.random() * 900000)}`;
    const nombreCompleto = [nombre1, nombre2, nombre3, apellido1, apellido2].filter(Boolean).join(" ");
    const usuario = `${nombre1}.${apellido1}`.toLowerCase();

    // ============================ GENERAR QR ============================
    const qrPath = `public/uploads/${codigoQR}.png`;
    const qrURL = `http://localhost:${port}/analizador.html?codigo=${codigoQR}`;
    await QRCode.toFile(qrPath, qrURL);
    const qrBuffer = fs.readFileSync(qrPath);

    // ============================ 🤖 Segmentación facial + aplicación de filtro alineado ============================
    let fotoFinalPath = fotoPath;
    let fotoFiltradaPath = null;
    let encodingFacial = null;

    if (fotoPath) {
      try {
        // 1️⃣ Convertir imagen original a Base64
        const imageBuffer = fs.readFileSync(fotoPath);
        const imageBase64 = imageBuffer.toString("base64");

        // 2️⃣ Enviar al servidor biométrico para segmentación
        const response = await axios.post(
          "http://www.server.daossystem.pro:3405/Rostro/Segmentar",
          { RostroA: imageBase64 },
          { headers: { "Content-Type": "application/json" }, timeout: 10000 }
        );

        // 3️⃣ Si el servidor devuelve rostro segmentado, lo guardamos
        if (response.data && response.data.rostro) {
          const imgData = Buffer.from(response.data.rostro, "base64");
          const segmentadoPath = path.resolve(__dirname, "public", "uploads", `${codigoQR}_rostro_segmentado.png`);
          fs.writeFileSync(segmentadoPath, imgData);
          fotoFinalPath = segmentadoPath;
          console.log("✅ Rostro segmentado correctamente.");

          // 🎨 Aplicar filtro perfectamente alineado
          if (filtro && filtro !== "ninguno") {
            const filtroPath = path.resolve(__dirname, "filtros", `${filtro}.png`);
            if (fs.existsSync(filtroPath)) {
              console.log(`🎨 Aplicando filtro '${filtro}'...`);

              const baseImg = await Jimp.read(fotoFinalPath);
              const overlay = await Jimp.read(filtroPath);
              const canvas = await canvasLoadImage(fotoFinalPath);
              const detection = await faceapi.detectSingleFace(canvas).withFaceLandmarks();

              if (detection && detection.landmarks) {
                const landmarks = detection.landmarks;
                const leftEye = landmarks.getLeftEye();
                const rightEye = landmarks.getRightEye();
                const mouth = landmarks.getMouth();

                const eyeCenterX = (leftEye[0].x + rightEye[3].x) / 2;
                const eyeCenterY = (leftEye[0].y + rightEye[3].y) / 2;
                const mouthCenterY = (mouth[3].y + mouth[9].y) / 2;
                const faceHeight = mouthCenterY - eyeCenterY;

                let offsetY = 0.35;
                let scaleFactor = 2.0;
                switch (filtro) {
                  case "perro": offsetY = 0.35; scaleFactor = 2.0; break;
                  case "gato": offsetY = 0.25; scaleFactor = 1.8; break;
                  case "lentes": offsetY = 0.15; scaleFactor = 1.5; break;
                  case "mapache": offsetY = 0.30; scaleFactor = 1.9; break;
                }

                const overlayWidth = faceHeight * scaleFactor * 1.3;
                const overlayHeight = faceHeight * scaleFactor * 1.2;
                overlay.resize(overlayWidth, overlayHeight, Jimp.RESIZE_BILINEAR);
                const overlayX = eyeCenterX - overlayWidth / 2;
                const overlayY = eyeCenterY - overlayHeight * offsetY;

                baseImg.composite(overlay, overlayX, overlayY, {
                  mode: Jimp.BLEND_SOURCE_OVER,
                  opacitySource: 0.95,
                });

                const filteredFilePath = path.resolve(__dirname, "public", "uploads", `${codigoQR}_rostro_filtrado.jpg`);
                await baseImg.quality(90).writeAsync(filteredFilePath);

                fotoFiltradaPath = filteredFilePath;
                fotoFinalPath = filteredFilePath;
                console.log(`✅ Imagen filtrada guardada como JPG en: ${filteredFilePath}`);
              } else {
                console.warn("⚠️ Landmarks no detectados; aplicando filtro genérico centrado.");
                overlay.resize(baseImg.bitmap.width, baseImg.bitmap.height);
                baseImg.composite(overlay, 0, 0, { opacitySource: 0.85 });
                const filteredFilePath = path.resolve(__dirname, "public", "uploads", `${codigoQR}_rostro_filtrado.jpg`);
                await baseImg.quality(90).writeAsync(filteredFilePath);
                fotoFiltradaPath = filteredFilePath;
                fotoFinalPath = filteredFilePath;
              }
            } else {
              console.warn(`⚠️ No se encontró el filtro: ${filtroPath}`);
            }
          }
        } else {
          console.warn("⚠️ No se recibió rostro segmentado; usando imagen original sin filtro.");
        }

        // 4️⃣ Generar encoding facial
        try {
          const canvas = await canvasLoadImage(fotoFinalPath);
          const detection = await faceapi
            .detectSingleFace(canvas)
            .withFaceLandmarks()
            .withFaceDescriptor();

          if (detection && detection.descriptor) {
            encodingFacial = JSON.stringify(Array.from(detection.descriptor));
            console.log("✅ Encoding facial generado correctamente.");
          } else {
            console.warn("⚠️ No se detectó rostro para generar encoding facial.");
          }
        } catch (err) {
          console.error("❌ Error generando encoding facial:", err.message);
        }

      } catch (error) {
        console.error("❌ Error durante la segmentación o filtro:", error.message);
      }
    }

    // ============================ INSERTA USUARIO ============================
    const sqlUsuario = `CALL sp_registrar_usuario(?, ?, ?, ?, ?, ?, ?, ?, @p_resultado, @p_mensaje);`;
    const imgBase64 = fotoFinalPath ? fs.readFileSync(fotoFinalPath).toString("base64") : null;

    db.query(
      sqlUsuario,
      [usuario, correo, nombreCompleto, password, telefono, imgBase64, 1, 1],
      async (err) => {
        if (err) {
          console.error("❌ Error al guardar en usuarios:", err);
          return res.status(500).json({ success: false, message: "Error al guardar usuario." });
        }

        const [rowsId] = await db.promise().query("SELECT id FROM usuarios WHERE email = ? LIMIT 1", [correo]);
        const usuarioId = rowsId?.[0]?.id;

        if (!usuarioId) {
          console.error("❌ No se encontró el usuario recién insertado.");
          return res.status(500).json({ success: false, message: "Usuario no encontrado tras el registro." });
        }

        console.log("🧍 Usuario ID:", usuarioId);

        if (encodingFacial) {
          try {
            await db.promise().query(
              `INSERT INTO autenticacion_facial (usuario_id, encoding_facial, imagen_referencia, activo, fecha_creacion)
               VALUES (?, ?, ?, 1, NOW())`,
              [usuarioId, encodingFacial, imgBase64]
            );
            console.log("✅ Registro facial guardado correctamente.");
          } catch (err3) {
            console.error("⚠️ Error al guardar autenticación facial:", err3);
          }
        } else {
          console.warn("⚠️ No se generó encoding facial, registro facial omitido.");
        }
        // ============================ 🧾 GUARDAR CÓDIGO QR EN BD ============================
        // 🧠 Generamos un hash único del código QR
        const crypto = require("crypto");
        const qrHash = crypto.createHash("sha256").update(codigoQR).digest("hex");

        try {
          await db.promise().query(
            `INSERT INTO codigos_qr (usuario_id, codigo_qr, qr_hash, activo)VALUES (?, ?, ?, 1)`,
            [usuarioId, codigoQR, qrHash]
          );
          console.log("✅ Código QR y hash guardados correctamente en BD.");
        } catch (err4) {
          console.error("⚠️ Error al guardar código QR:", err4);
        }


        await generarPDFsYEnviarCorreo({
          nombre1,
          apellido1,
          nombreCompleto,
          correo,
          telefono,
          cedula,
          filtro,
          imgOriginalPath: fotoPath,
          imgFiltradaPath: fotoFiltradaPath,
          qrBuffer,
          codigoQR,
          qrPath,
        });

        enviarWhatsApp(nombre1, apellido1, telefono, codigoQR);

        res.json({
          success: true,
          message: "✅ Usuario registrado correctamente. QR vinculado al usuario.",
        });
      }
    );
  } catch (error) {
    console.error("❌ Error general en /api/registrar:", error);
    res.status(500).json({ success: false, message: "Error general del servidor." });
  }
});


// ============================
// 🔐 LOGIN USUARIO (Base Centralizada con fn_encriptar_password)
// ============================
// ============================
// 🔐 LOGIN USUARIO (Base Centralizada con fn_encriptar_password)
// ============================
app.post("/api/login", async (req, res) => {
  try {
    // ✅ 1. Capturar datos del body
    const { correo, password } = req.body;
    console.log("📥 Intentando login con:", correo, password);

    if (!correo || !password) {
      return res.status(400).json({
        success: false,
        message: "⚠️ Faltan datos: correo o contraseña",
      });
    }

    // ✅ 2. Ejecutar procedimiento almacenado con los parámetros correctos
    const sql = `CALL sp_login_correo(?, ?, @p_resultado, @p_mensaje, @p_session_token);`;

    db.query(sql, [correo, password], (err) => {
      if (err) {
        console.error("❌ Error al ejecutar SP sp_login_correo:", err);
        return res.status(500).json({
          success: false,
          message: "Error en el servidor (SP).",
        });
      }

      // ✅ 3. Consultar los valores de salida del SP
      db.query(
        "SELECT @p_resultado AS resultado, @p_mensaje AS mensaje, @p_session_token AS token;",
        (err2, rows) => {
          if (err2) {
            console.error("⚠️ Error al obtener resultados del SP:", err2);
            return res.status(500).json({
              success: false,
              message: "Error interno del sistema.",
            });
          }

          const { resultado, mensaje, token } = rows[0] || {};

          console.log("🧾 Resultado SP:", rows[0]);

          // ✅ 4. Validar resultado del SP
          if (!resultado || resultado === 0) {
            console.warn("⚠️ Login fallido:", mensaje);
            return res.status(401).json({
              success: false,
              message: mensaje || "Credenciales inválidas.",
            });
          }

          // ✅ 5. Si todo va bien
          console.log(`✅ Login exitoso para ${correo}. Token: ${token}`);

          // 🔹 Obtener los datos completos del usuario
          db.query("SELECT id, nombre_completo, email, telefono FROM usuarios WHERE email = ? LIMIT 1", [correo], (err3, rows3) => {
            if (err3 || !rows3.length) {
              console.error("⚠️ No se pudo obtener información completa del usuario:", err3);
              return res.json({
                success: true,
                message: mensaje || "Inicio de sesión correcto.",
                token,
                usuario: { correo }, // fallback
              });
            }

            const user = rows3[0];
            res.json({
              success: true,
              message: mensaje || "Inicio de sesión correcto.",
              token,
              usuario: user,
            });
          });
        }
      );
    });
  } catch (error) {
    console.error("❌ Error general en /api/login:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor.",
    });
  }
});





// ============================
// 🔑 Login por código QR (base centralizada)
// ============================
app.post("/api/login-qr", (req, res) => {
  const { codigo } = req.body;
  if (!codigo)
    return res.status(400).json({ success: false, message: "Código QR inválido" });

  const sql = `
    SELECT u.id, u.nombre_completo, u.email, u.telefono
    FROM codigos_qr q
    INNER JOIN usuarios u ON q.usuario_id = u.id
    WHERE q.codigo_qr = ? AND q.activo = 1
  `;

  db.query(sql, [codigo], (err, results) => {
    if (err) {
      console.error("❌ Error en login QR:", err);
      return res.status(500).json({ success: false, message: "Error en el servidor" });
    }

    if (results.length === 0)
      return res.status(401).json({ success: false, message: "QR no registrado o inactivo" });

    const user = results[0];
    console.log(`✅ Login QR exitoso para ${user.nombre_completo} (${user.email})`);
    res.json({
      success: true,
      message: `Bienvenido, ${user.nombre_completo}`,
      usuario: user,
    });
  });
});


// ============================
// 🔍 Verificar carné QR (Base Centralizada)
// ============================
app.get("/verificar", (req, res) => {
  const { codigo } = req.query;
  if (!codigo) return res.send("<h3>⚠️ Código no proporcionado.</h3>");

  const sql = `
    SELECT u.*, q.codigo_qr
    FROM codigos_qr q
    INNER JOIN usuarios u ON q.usuario_id = u.id
    WHERE q.codigo_qr = ? AND q.activo = 1
  `;

  db.query(sql, [codigo], (err, results) => {
    if (err || results.length === 0)
      return res.send("<h3>❌ QR no registrado o inválido.</h3>");

    const user = results[0];
    res.send(`
      <div style="text-align:center;font-family:sans-serif;padding:30px;">
        <img src="https://upload.wikimedia.org/wikipedia/commons/3/39/Logo_UMG.png" width="90">
        <h2>Carné UMG — ${user.nombre_completo}</h2>
        <p><b>Código QR:</b> ${user.codigo_qr}</p>
        <p><b>Correo:</b> ${user.email}</p>
        <p><b>Teléfono:</b> ${user.telefono}</p>
        <p style="color:green;font-weight:bold;">Estado: ACTIVO ✅</p>
      </div>
    `);
  });
});
// ============================
// 👁️ LOGIN POR RECONOCIMIENTO FACIAL (Base Centralizada)
// ============================
app.post("/api/login-face", upload.single("rostro"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No se envió imagen." });

    const uploadedImage = await canvasLoadImage(req.file.path);
    const detection = await faceapi.detectSingleFace(uploadedImage).withFaceLandmarks().withFaceDescriptor();

    if (!detection) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: "No se detectó ningún rostro." });
    }

    // Obtener todos los usuarios con rostro registrado
    const query = `
      SELECT a.usuario_id, a.imagen_referencia, a.encoding_facial, u.nombre_completo
      FROM autenticacion_facial a
      INNER JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.activo = 1
    `;

    db.query(query, async (err, results) => {
      if (err) {
        console.error("Error al obtener datos faciales:", err);
        return res.status(500).json({ success: false, message: "Error en el servidor." });
      }

      let mejorCoincidencia = null;
      let menorDistancia = 1.0;

      for (const user of results) {
        try {
          const dbEncoding = JSON.parse(user.encoding_facial);
          const distancia = faceapi.euclideanDistance(detection.descriptor, Float32Array.from(dbEncoding));
          if (distancia < menorDistancia) {
            menorDistancia = distancia;
            mejorCoincidencia = user;
          }
        } catch (e) {
          console.error("Error comparando con usuario:", user.usuario_id, e.message);
        }
      }

      fs.unlinkSync(req.file.path);

      if (mejorCoincidencia && menorDistancia < 0.85) {
        console.log(`✅ Rostro reconocido: ${mejorCoincidencia.nombre_completo} (distancia ${menorDistancia.toFixed(2)})`);

        // 🔹 Obtener datos completos del usuario (para incluir email y teléfono)
        db.query(
          "SELECT id, nombre_completo, email, telefono FROM usuarios WHERE id = ? LIMIT 1",
          [mejorCoincidencia.usuario_id],
          (err2, rows2) => {
            if (err2 || !rows2.length) {
              console.error("⚠️ No se pudo obtener datos completos del usuario:", err2);
              return res.json({
                success: true,
                message: `Bienvenido, ${mejorCoincidencia.nombre_completo}`,
                usuario: mejorCoincidencia, // fallback
              });
            }

            const user = rows2[0];
            res.json({
              success: true,
              message: `Bienvenido, ${user.nombre_completo}`,
              usuario: user,
            });
          }
        );
      } else {
        console.log("❌ Ninguna coincidencia facial encontrada.");
        return res.status(401).json({ success: false, message: "Rostro no reconocido." });
      }

    }); // ✅ cierre del db.query

  } catch (error) {
    console.error("❌ Error general en /api/login-face:", error);
    res.status(500).json({ success: false, message: "Error general del servidor." });
  }
}); // ✅ cierre del endpoint /api/login-face




// ============================
// 🧩 Helper para generar PDFs con Puppeteer
// ============================

async function renderHtmlToPdf(htmlString, outPath) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
    timeout: 0,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    await page.setContent(htmlString, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 0,
    });

    await page.emulateMediaType("screen");
    await page.pdf({
      path: outPath,
      format: "A4",
      landscape: true, // 📄 Horizontal (apaisado)
      printBackground: true,
      margin: {
        top: "0cm",
        bottom: "0cm",
        left: "0cm",
        right: "0cm"
      },
      preferCSSPageSize: true
    });

  } catch (err) {
    console.error("⚠️ Error generando PDF:", err);
  } finally {
    await browser.close();
  }
}





async function generarPDFsYEnviarCorreo({
  nombre1,
  apellido1,
  nombreCompleto,
  correo,
  telefono,
  cedula,
  filtro,
  imgOriginalPath,      // ✅ ahora recibe las rutas
  imgFiltradaPath,      // ✅ con filtro (si existe)
  qrBuffer,
  codigoQR,
  qrPath
}) {
  console.log("🧾 Entrando a generarPDFsYEnviarCorreo (Puppeteer)...");
  try {
    // 1) Carga plantilla
    const htmlTemplate = fs.readFileSync(
      path.join(__dirname, "public", "plantilla_carnet.html"),
      "utf8"
    );

    // 2) Incrusta LOGO en base64 (evita rutas/OneDrive/timeouts)
    const logoFile = path.join(__dirname, "public", "img", "logo_umg.png");
    const logoBase64 = fs.readFileSync(logoFile).toString("base64");
    const logoData = `data:image/png;base64,${logoBase64}`;

    // 3) Datos comunes
    const qrData = `data:image/png;base64,${qrBuffer.toString("base64")}`;
    // Imagen original (sin filtro)
    const imgOriginalBase64 = fs.readFileSync(imgOriginalPath).toString("base64");
    const fotoDataNormal = `data:image/jpeg;base64,${imgOriginalBase64}`;

    // Imagen filtrada (si existe)
    let fotoDataFiltro = fotoDataNormal;
    if (imgFiltradaPath && fs.existsSync(imgFiltradaPath)) {
      const imgFiltradaBase64 = fs.readFileSync(imgFiltradaPath).toString("base64");
      fotoDataFiltro = `data:image/jpeg;base64,${imgFiltradaBase64}`;
    }


    const baseReplacements = (tpl, versionTexto, color) =>
      tpl
        .replace(/{{LOGO}}/g, logoData)
        .replace(/{{NOMBRE}}/g, nombreCompleto)
        .replace(/{{CEDULA}}/g, cedula || "N/A")
        .replace(/{{CORREO}}/g, correo)
        .replace(/{{TELEFONO}}/g, telefono)
        .replace(/{{CODIGO}}/g, codigoQR)
        .replace(/{{QR}}/g, qrData)
        .replace(/{{FILTRO}}/g, versionTexto)
        .replace(/{{BANDA_COLOR}}/g, color);


    // 4) HTML con filtro y sin filtro
    const htmlConFiltro = baseReplacements(htmlTemplate, "CON FILTRO", "#0069d9")
      .replace(/{{FOTO}}/g, fotoDataFiltro);

    const htmlSinFiltro = baseReplacements(htmlTemplate, "SIN FILTRO", "#6c757d")
      .replace(/{{FOTO}}/g, fotoDataNormal);



    // 5) Rutas de salida
    const pdfConFiltroPath = path.join(__dirname, "public", "uploads", `${codigoQR}_carnet.pdf`);
    const pdfSinFiltroPath = path.join(__dirname, "public", "uploads", `${codigoQR}_sin_filtro.pdf`);

    // 6) Render PDFs
    console.log("📄 Generando PDF con filtro...");
    await renderHtmlToPdf(htmlConFiltro, pdfConFiltroPath);
    console.log("✅ PDF con filtro generado:", pdfConFiltroPath);

    console.log("📄 Generando PDF sin filtro...");
    await renderHtmlToPdf(htmlSinFiltro, pdfSinFiltroPath);
    console.log("✅ PDF sin filtro generado:", pdfSinFiltroPath);

    // 7) Enviar correo
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "joseemmanuelfelipefranco@gmail.com", pass: "mrmuwhetqsyxhend" },
    });

    await transporter.sendMail({
      from: '"UMG - Registro" <joseemmanuelfelipefranco@gmail.com>',
      to: correo,
      subject: "🎓 Carné Universitario UMG — Registro exitoso",
      html: `<h3>Bienvenido ${nombre1} ${apellido1}</h3>
             <p>Adjuntamos tus carnés (con y sin filtro).</p>
             <p>Escanea tu código QR para iniciar sesión o verificar tu identidad.</p>`,
      attachments: [
        { filename: "carnet_umg_con_filtro.pdf", path: pdfConFiltroPath },
        { filename: "carnet_umg_sin_filtro.pdf", path: pdfSinFiltroPath },
        { filename: "qr.png", path: qrPath },
      ],
    });

    console.log(`📧 Correo enviado correctamente a ${correo}`);
  } catch (error) {
    console.error("❌ Error al generar/enviar PDFs con Puppeteer:", error);
  }
}




function enviarWhatsApp(nombre1, apellido1, telefono, codigoQR) {
  try {
    const pythonScript = path.join(__dirname, "send_whatsapp.py");
    const numeroDestino = `+502${telefono.replace(/\D/g, "")}`;
    console.log("📲 Enviando WhatsApp a", numeroDestino);
    const pythonProcess = spawn("python", [pythonScript, numeroDestino, `${nombre1} ${apellido1}`, codigoQR]);
    pythonProcess.stdout.on("data", (data) => console.log(`🐍 Python: ${data}`));
  } catch (err) {
    console.error("❌ Error al enviar WhatsApp:", err.message);
  }
}

// ============================
// 🧠 ANALIZADOR LÉXICO MULTILINGÜE (Integrado con base local)
// ============================
const nlp = require("compromise");

app.post("/analizar", upload.single("archivo"), async (req, res) => {
  try {
    const idioma = req.body.idioma?.toLowerCase() || "es";
    const idUsuario = req.body.id_usuario || null;
    const contenido = fs.readFileSync(req.file.path, "utf8");

    // 🔤 Separar palabras según idioma
    let palabras;
    if (idioma.includes("chino") || idioma === "zh") {
      palabras = contenido.match(/[\p{Script=Han}]/gu) || [];
    } else if (idioma.includes("ruso") || idioma === "ru") {
      palabras = contenido.match(/[\p{Script=Cyrillic}]+/gu) || [];
    } else if (idioma.includes("arabe") || idioma === "ar") {
      palabras = contenido.match(/[\p{Script=Arabic}]+/gu) || [];
      if (palabras.length === 0) {
        const limpia = contenido.replace(/[^\p{Script=Arabic}\s]/gu, "").trim();
        palabras = limpia.split(/\s+/).filter(Boolean);
      }
    } else {
      palabras = contenido.match(/\b[\wáéíóúüñ]+\b/g) || [];
    }

    const totalPalabras = palabras.length;
    const totalCaracteres = contenido.length;

    // 📊 Calcular frecuencia
    const frecuencia = {};
    palabras.forEach(p => {
      const lower = p.toLowerCase();
      frecuencia[lower] = (frecuencia[lower] || 0) + 1;
    });

    const topPalabras = Object.entries(frecuencia)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const menosPalabras = Object.entries(frecuencia)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 10);

    // 🧠 NLP — obtener categorías
    const doc = nlp(contenido);
    const pronombres = doc.pronouns().out("array") || [];
    const personas = doc.people().out("array") || [];
    const lugares = doc.places().out("array") || [];
    const verbos = doc.verbs().out("array") || [];
    const sustantivos = doc.nouns().out("array") || [];

    // 💾 Guardar resultados en base local analizador_db
    const sql = `
      INSERT INTO analisis (
        id_usuario, nombre_archivo, idioma, total_palabras, total_caracteres,
        pronombres_json, entidades_json, lemas_json, fecha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW());
    `;
    dbAnalisis.query(sql, [
      idUsuario,
      req.file.originalname,
      idioma,
      totalPalabras,
      totalCaracteres,
      JSON.stringify(pronombres),
      JSON.stringify({ personas, lugares }),
      JSON.stringify({ sustantivos, verbos })
    ], (err) => {
      if (err) console.error("⚠️ Error guardando en analizador_db:", err.message);
      else console.log(`✅ Análisis guardado correctamente (${req.file.originalname})`);
    });

    // 📤 Responder al cliente
    res.json({
      idioma,
      totalPalabras,
      totalCaracteres,
      topPalabras,
      menosPalabras,
      pronombres,
      personas,
      lugares,
      verbos,
      sustantivos,
      texto: contenido
    });

    fs.unlinkSync(req.file.path); // elimina archivo temporal
  } catch (error) {
    console.error("❌ Error en /analizar:", error);
    res.status(500).json({ error: "Error al procesar análisis" });
  }
});

// ============================
// 📄 GENERAR REPORTE PDF DEL ANÁLISIS
// ============================
const PDFDocument = require("pdfkit");

app.post("/generar-pdf", async (req, res) => {
  try {
    const { resultados } = req.body;
    if (!resultados) {
      return res.status(400).json({ error: "No se recibieron datos para generar el PDF." });
    }

    // 📘 Crear el documento PDF
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `reporte_analisis_${Date.now()}.pdf`;
    const filePath = path.join(__dirname, "public", "uploads", fileName);

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // 🧩 Encabezado
    doc.fontSize(20).text("📊 REPORTE DE ANÁLISIS LÉXICO", { align: "center" });
    doc.moveDown(1);

    // 📋 Datos generales
    doc.fontSize(12)
      .text(`Idioma: ${resultados.idioma}`)
      .text(`Total palabras: ${resultados.totalPalabras}`)
      .text(`Total caracteres: ${resultados.totalCaracteres}`)
      .moveDown();

    // 🔝 Top palabras
    doc.font("Helvetica-Bold").text("Top palabras más frecuentes:", { underline: true });
    doc.font("Helvetica").list(resultados.topPalabras.map(([w, c]) => `${w} (${c})`));
    doc.moveDown();

    // 🔻 Menos frecuentes
    doc.font("Helvetica-Bold").text("Palabras menos frecuentes:", { underline: true });
    doc.font("Helvetica").list(resultados.menosPalabras.map(([w, c]) => `${w} (${c})`));
    doc.moveDown();

    // 💬 Pronombres, Personas, Sustantivos, Verbos
    doc.text(`Pronombres: ${resultados.pronombres.join(", ") || "N/A"}`);
    doc.text(`Personas: ${resultados.personas.join(", ") || "N/A"}`);
    doc.text(`Lugares: ${resultados.lugares.join(", ") || "N/A"}`);
    doc.text(`Sustantivos: ${resultados.sustantivos.join(", ") || "N/A"}`);
    doc.text(`Verbos: ${resultados.verbos.join(", ") || "N/A"}`);
    doc.moveDown(1);

    // 📝 Texto analizado
    doc.font("Helvetica-Bold").text("Texto analizado:", { underline: true });
    doc.font("Helvetica").text(resultados.texto, { align: "justify" });

    // 🏁 Cierre
    doc.moveDown(2);
    doc.fontSize(10).text("Generado automáticamente por el Sistema de Análisis Léxico Multilingüe — UMG 2025", {
      align: "center",
    });

    doc.end();

    // 📨 Enviar el archivo generado
    stream.on("finish", () => {
      res.download(filePath, fileName, (err) => {
        if (err) console.error("⚠️ Error al enviar PDF:", err);
        fs.unlinkSync(filePath); // elimina después de descargar
      });
    });
  } catch (error) {
    console.error("❌ Error generando PDF:", error);
    res.status(500).json({ error: "Error al generar el PDF." });
  }
});



// ============================
// 📧 Enviar resultados del análisis por correo
// ============================
app.post("/enviar-correo", async (req, res) => {
  try {
    const { correo, nombre, resultados } = req.body;
    if (!correo || !resultados) {
      return res.status(400).json({ success: false, message: "Faltan datos" });
    }

    // Crear PDF temporal del análisis
    const PDFDocument = require("pdfkit");
    const pdfPath = path.join(__dirname, "public", "uploads", `analisis_${Date.now()}.pdf`);
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    doc.fontSize(18).text("📊 REPORTE DE ANÁLISIS LÉXICO", { align: "center" }).moveDown();
    doc.fontSize(12).text(`Usuario: ${nombre}`);
    doc.text(`Correo: ${correo}`).moveDown();
    doc.text(`Idioma: ${resultados.idioma}`);
    doc.text(`Total palabras: ${resultados.totalPalabras}`);
    doc.text(`Total caracteres: ${resultados.totalCaracteres}`).moveDown();

    doc.text("Top palabras más frecuentes:");
    resultados.topPalabras.forEach(([w, c]) => doc.text(`- ${w}: ${c}`));
    doc.moveDown();

    doc.text("Palabras menos frecuentes:");
    resultados.menosPalabras.forEach(([w, c]) => doc.text(`- ${w}: ${c}`));
    doc.moveDown();

    doc.text(`Pronombres: ${resultados.pronombres.join(", ")}`);
    doc.text(`Personas: ${resultados.personas.join(", ")}`);
    doc.text(`Lugares: ${resultados.lugares.join(", ")}`);
    doc.text(`Sustantivos: ${resultados.sustantivos.join(", ")}`);
    doc.text(`Verbos: ${resultados.verbos.join(", ")}`).moveDown();
    doc.text("Texto original analizado:").moveDown();
    doc.font("Helvetica-Oblique").text(resultados.texto, { align: "justify" });
    doc.end();

    stream.on("finish", async () => {
      // Configura tu correo de envío (usa el mismo que para carnés)
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "joseemmanuelfelipefranco@gmail.com",
          pass: "mrmuwhetqsyxhend", // contraseña de app de Gmail
        },
      });

      await transporter.sendMail({
        from: '"UMG - Analizador Léxico" <joseemmanuelfelipefranco@gmail.com>',
        to: correo,
        cc: "proyecto.umg@gmail.com", // copia al correo del grupo
        subject: "📊 Resultados del Análisis Léxico UMG",
        html: `<p>Hola <b>${nombre}</b>,</p>
               <p>Adjuntamos tu reporte en PDF con los resultados del análisis léxico realizado en el sistema UMG.</p>
               <p>Gracias por utilizar la plataforma.</p>`,
        attachments: [
          { filename: "analisis.pdf", path: pdfPath }
        ],
      });

      fs.unlinkSync(pdfPath); // elimina PDF temporal
      res.json({ success: true });
    });

  } catch (error) {
    console.error("❌ Error al enviar correo:", error);
    res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
});

// ============================
// 🚀 Iniciar servidor
// ============================
app.listen(port, () => console.log(`🚀 Servidor activo en http://localhost:${port}`));

// ============================
// 🧠 Helper para Canvas
// ============================
async function canvasLoadImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

