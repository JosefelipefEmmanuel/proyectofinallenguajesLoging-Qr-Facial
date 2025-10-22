// ================================================================
// 🚀 PROYECTO UMG - RECONOCIMIENTO FACIAL + ANALIZADOR LÉXICO
// Versión mejorada con validaciones, manejo de errores y sanitización
// ================================================================

// ===============================
// 🔧 CONFIGURACIÓN GLOBAL
// ===============================
const API_URL = "http://localhost:3000"; // Cambiar en producción a tu dominio
let labeledFaceDescriptors = [];
let modelsLoaded = false;
let selectedEmpresaId = null;
let loadedUsers = new Set();
let recognitionActive = false;
let intervalId = null;
let streamActual = null;
const DEVICE_CODE = '02'; // Identificador del dispositivo

// Variable para datos del analizador
let datosActuales = null;

// ===============================
// 🛡️ UTILIDADES DE SEGURIDAD
// ===============================
function escaparHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escaparRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mostrarError(mensaje) {
  const errorDiv = document.getElementById('error-message');
  if (errorDiv) {
    errorDiv.textContent = mensaje;
    errorDiv.style.display = 'block';
    errorDiv.style.background = 'rgba(255,0,0,0.2)';
    errorDiv.style.borderLeft = '4px solid #ff0000';
    errorDiv.style.padding = '10px';
    errorDiv.style.margin = '10px 0';
    errorDiv.style.borderRadius = '5px';
    setTimeout(() => errorDiv.style.display = 'none', 5000);
  } else {
    alert(mensaje);
  }
}

// ===============================
// 🧩 UTILIDADES VISUALES
// ===============================
function showLoadingMessage(show) {
  const msg = document.getElementById('loading-message');
  if (msg) msg.style.display = show ? 'block' : 'none';
}

function hideEmpresaForm() {
  const form = document.getElementById('empresa-selection');
  if (form) form.style.display = 'none';
}

function capturePhoto(videoElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

// ===============================
// 🤖 CARGA DE MODELOS Y USUARIOS
// ===============================
async function loadModels() {
  const MODEL_URL = '/models';
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  modelsLoaded = true;
  console.log("✅ Modelos FaceAPI cargados.");
}

async function loadLabeledImagesAsync() {
  if (!selectedEmpresaId) return console.error("❌ No se ha seleccionado una empresa.");
  showLoadingMessage(true);
  labeledFaceDescriptors = [];
  loadedUsers.clear();

  try {
    const response = await fetch(`${API_URL}/get-labels?empresaId=${selectedEmpresaId}`);
    const { labels } = await response.json();
    for (const label of labels) await loadUserDescriptor(label);
    console.log("✅ Descriptores cargados:", labeledFaceDescriptors.length);
  } catch (err) {
    console.error("Error cargando descriptores:", err);
    mostrarError("⚠️ Error al cargar descriptores faciales");
  } finally {
    showLoadingMessage(false);
  }
}

async function loadUserDescriptor(label) {
  if (loadedUsers.has(label)) return;
  loadedUsers.add(label);

  try {
    const res = await fetch(`${API_URL}/get-image?name=${label}&empresaId=${selectedEmpresaId}`);
    const blob = await res.blob();
    const img = await faceapi.bufferToImage(blob);
    const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
    if (detection) labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(label, [detection.descriptor]));
  } catch (err) {
    console.error(`Error cargando imagen de ${label}:`, err);
  }
}

// ===============================
// 📸 CÁMARA Y RECONOCIMIENTO
// ===============================
async function startCamera() {
  if (recognitionActive || !modelsLoaded) return;
  
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    mostrarError("❌ Tu navegador no soporta acceso a cámara");
    return;
  }

  recognitionActive = true;
  const video = document.getElementById('video');
  
  try {
    streamActual = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = streamActual;
    video.play();
  } catch (error) {
    console.error('Error al activar la cámara:', error);
    mostrarError('❌ No se pudo acceder a la cámara. Verifica los permisos.');
    recognitionActive = false;
    return;
  }

  video.addEventListener('loadeddata', async () => {
    const cameraContainer = document.getElementById('camera');
    const canvas = faceapi.createCanvasFromMedia(video);
    cameraContainer.appendChild(canvas);
    const displaySize = { width: video.clientWidth, height: video.clientHeight };
    faceapi.matchDimensions(canvas, displaySize);

    intervalId = setInterval(async () => {
      const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
      const resized = faceapi.resizeResults(detections, displaySize);

      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      faceapi.draw.drawDetections(canvas, resized);

      if (!labeledFaceDescriptors.length) return;
      const faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.5);
      const results = resized.map(d => faceMatcher.findBestMatch(d.descriptor));

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const box = resized[i].detection.box;
        new faceapi.draw.DrawBox(box, {
          label: result.toString(),
          boxColor: result.label === 'unknown' ? 'red' : 'green'
        }).draw(canvas);

        if (result.label === 'unknown') {
          notifyUser('🔴 Usuario no reconocido', true);
          await registerFailedAttempt(capturePhoto(video));
        } else {
          await handleRecognitionSuccess(result.label, video);
        }
      }
    }, 1000);
  });
}

function stopCamera() {
  const video = document.getElementById('video');
  
  // Detener stream de cámara correctamente
  if (streamActual) {
    streamActual.getTracks().forEach(track => track.stop());
    streamActual = null;
  }
  
  if (video.srcObject) {
    video.srcObject = null;
  }
  
  recognitionActive = false;
  clearInterval(intervalId);

  const canvas = document.querySelector('#camera canvas');
  if (canvas) canvas.remove();
  
  const resultDiv = document.getElementById('recognition-result');
  if (resultDiv) resultDiv.style.display = 'none';
  
  console.log("🛑 Cámara detenida correctamente.");
}

// ===============================
// 🚀 EVENTOS INICIALES
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  const empresaSelect = document.getElementById("empresaSelect");

  if (empresaSelect) {
    try {
      const res = await fetch(`${API_URL}/get-empresas`);
      const empresas = await res.json();
      empresaSelect.innerHTML = empresas.map(e => `<option value="${e.id}">${escaparHTML(e.nombre)}</option>`).join('');
    } catch (err) {
      console.error(err);
      mostrarError("❌ No se pudieron cargar las empresas.");
    }

    const selectBtn = document.getElementById('selectEmpresa');
    if (selectBtn) {
      selectBtn.addEventListener('click', async () => {
        selectedEmpresaId = empresaSelect.value;
        if (!selectedEmpresaId) return alert("Seleccione una empresa primero.");
        await loadModels();
        await loadLabeledImagesAsync();
        hideEmpresaForm();
        const mainContent = document.getElementById('main-content');
        if (mainContent) mainContent.style.display = 'block';
      });
    }
  }

  // Botones de cámara
  const startCameraBtn = document.getElementById('start-camera');
  if (startCameraBtn) startCameraBtn.addEventListener('click', startCamera);
  
  const stopCameraBtn = document.getElementById('stop-camera');
  if (stopCameraBtn) stopCameraBtn.addEventListener('click', stopCamera);
});

// ===============================
// 📋 REGISTRO DE RECONOCIMIENTO
// ===============================
async function getUserIdByName(name) {
  try {
    const res = await fetch(`${API_URL}/get-user-id?name=${name}&empresaId=${selectedEmpresaId}`);
    return res.ok ? (await res.json()).id : null;
  } catch (err) {
    console.error("Error obteniendo ID de usuario:", err);
    return null;
  }
}

async function handleRecognitionSuccess(nombre, video) {
  const tipoSelect = document.getElementById('tipoRegistro');
  if (!tipoSelect) return;
  
  const tipo = tipoSelect.value;
  if (!tipo) return notifyUser("⚠️ Seleccione Entrada o Salida", true);

  const userId = await getUserIdByName(nombre);
  if (!userId) {
    notifyUser("❌ No se pudo obtener ID del usuario", true);
    return;
  }

  const photoBase64 = capturePhoto(video);
  const ok = tipo === 'entrada'
    ? await registerEntry(userId, photoBase64)
    : await registerExit(userId);

  if (ok) {
    notifyUser(`✅ ${tipo.toUpperCase()} registrada para ${nombre}`);
    showCustomAlert(`✅ ${tipo.toUpperCase()}: ${nombre}`);
  } else {
    notifyUser(`❌ Error al registrar ${tipo}`, true);
  }
}

// ===============================
// 📥 REGISTROS
// ===============================
async function registerEntry(userId, photoBase64) {
  try {
    const res = await fetch(`${API_URL}/register-entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuarioId: userId,
        empresaId: selectedEmpresaId,
        deviceCode: DEVICE_CODE,
        resultado_autenticacion: "Exitosa",
        foto_intento: photoBase64
      })
    });
    return res.ok;
  } catch (err) {
    console.error("Error registrando entrada:", err);
    return false;
  }
}

async function registerExit(userId) {
  try {
    const res = await fetch(`${API_URL}/register-exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuarioId: userId,
        empresaId: selectedEmpresaId,
        deviceCode: DEVICE_CODE
      })
    });
    return res.ok;
  } catch (err) {
    console.error("Error registrando salida:", err);
    return false;
  }
}

async function registerFailedAttempt(photoBase64) {
  try {
    await fetch(`${API_URL}/register-failed-attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Desconocido',
        empresaId: selectedEmpresaId,
        motivo: 'Usuario no registrado',
        fotoIntento: photoBase64,
        deviceCode: DEVICE_CODE
      })
    });
  } catch (err) {
    console.error("Error registrando intento fallido:", err);
  }
}

// ===============================
// 💬 MENSAJES VISUALES
// ===============================
function notifyUser(message, isError = false) {
  const el = document.getElementById('recognition-result');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  el.style.backgroundColor = isError ? '#ffcccc' : '#ccffcc';
  el.style.color = isError ? 'red' : 'green';
  el.style.fontWeight = 'bold';
}

function showCustomAlert(message) {
  const alertBox = document.getElementById('custom-alert');
  if (!alertBox) return;
  alertBox.textContent = message;
  alertBox.style.display = 'block';
  setTimeout(() => alertBox.style.display = 'none', 4000);
}

// =============================================================
// 🧠 MÓDULO MEJORADO: ANALIZADOR LÉXICO MULTILINGÜE
// =============================================================

// 🔍 Validación de archivos
function validarArchivo(archivo) {
  if (!archivo) {
    mostrarError("⚠️ Por favor selecciona un archivo");
    return false;
  }

  if (!archivo.name.endsWith('.txt')) {
    mostrarError("⚠️ Solo se permiten archivos .txt");
    return false;
  }

  const maxSize = 5 * 1024 * 1024; // 5MB
  if (archivo.size > maxSize) {
    mostrarError("⚠️ El archivo es muy grande (máximo 5MB)");
    return false;
  }

  if (archivo.size === 0) {
    mostrarError("⚠️ El archivo está vacío");
    return false;
  }

  return true;
}

// 📊 Mostrar resultados mejorados
function mostrarResultados(data) {
  const resultados = document.getElementById("resultados");
  const resumen = document.getElementById("resumen");
  const textoResaltado = document.getElementById("textoResaltado");

  if (!resultados || !resumen || !textoResaltado) {
    console.error("⚠️ Elementos del DOM no encontrados");
    return;
  }

  resultados.style.display = "block";

  // Construir HTML con sanitización
  let html = `
    <div class="row mb-3">
      <div class="col-md-6">
        <p><b>📝 Idioma:</b> ${escaparHTML(data.idioma)}</p>
        <p><b>📊 Total palabras:</b> ${data.totalPalabras}</p>
        <p><b>🔤 Total caracteres:</b> ${data.totalCaracteres}</p>
      </div>
      <div class="col-md-6">
        ${data.palabrasUnicas ? `<p><b>🔢 Palabras únicas:</b> ${data.palabrasUnicas}</p>` : ''}
        ${data.densidadLexica ? `<p><b>📈 Densidad léxica:</b> ${data.densidadLexica}</p>` : ''}
        ${data.totalOraciones ? `<p><b>📄 Oraciones:</b> ${data.totalOraciones}</p>` : ''}
      </div>
    </div>
    <hr>
    <p><b>🔝 Top palabras:</b> ${data.topPalabras.map(([w,c]) => `${escaparHTML(w)} (${c})`).join(", ")}</p>
    <p><b>🔻 Menos frecuentes:</b> ${data.menosPalabras.map(([w,c]) => `${escaparHTML(w)} (${c})`).join(", ")}</p>
    <hr>
  `;

  // Pronombres
  if (data.pronombres && data.pronombres.length > 0) {
    html += `<p><b>💬 Pronombres:</b> ${data.pronombres.map(escaparHTML).join(", ")}</p>`;
  }

  // Personas
  if (data.personas && data.personas.length > 0) {
    html += `<p><b>👤 Personas:</b> ${data.personas.map(escaparHTML).join(", ")}</p>`;
  } else {
    html += `<p><b>👤 Personas:</b> <span class="text-muted">No detectadas</span></p>`;
  }

  // Lugares
  if (data.lugares && data.lugares.length > 0) {
    html += `<p><b>📍 Lugares:</b> ${data.lugares.map(escaparHTML).join(", ")}</p>`;
  } else {
    html += `<p><b>📍 Lugares:</b> <span class="text-muted">No detectados</span></p>`;
  }

  // Sustantivos (limitar a 20)
  if (data.sustantivos && data.sustantivos.length > 0) {
    const sustantivos = data.sustantivos.slice(0, 20);
    html += `<p><b>📝 Sustantivos:</b> ${sustantivos.map(escaparHTML).join(", ")}`;
    if (data.sustantivos.length > 20) html += ` <small class="text-muted">(+${data.sustantivos.length - 20} más)</small>`;
    html += `</p>`;
  }

  // Verbos (limitar a 20)
  if (data.verbos && data.verbos.length > 0) {
    const verbos = data.verbos.slice(0, 20);
    html += `<p><b>🔤 Verbos:</b> ${verbos.map(escaparHTML).join(", ")}`;
    if (data.verbos.length > 20) html += ` <small class="text-muted">(+${data.verbos.length - 20} más)</small>`;
    html += `</p>`;
  }

  // Clasificaciones adicionales
  if (data.fechas && data.fechas.length > 0) {
    html += `<p><b>📅 Fechas:</b> ${data.fechas.map(escaparHTML).join(", ")}</p>`;
  }

  if (data.numeros && data.numeros.length > 0) {
    html += `<p><b>🔢 Números:</b> ${data.numeros.slice(0, 15).map(escaparHTML).join(", ")}</p>`;
  }

  if (data.emails && data.emails.length > 0) {
    html += `<p><b>📧 Emails:</b> ${data.emails.map(escaparHTML).join(", ")}</p>`;
  }

  if (data.urls && data.urls.length > 0) {
    html += `<p><b>🔗 URLs:</b> ${data.urls.map(escaparHTML).join(", ")}</p>`;
  }

  if (data.telefonos && data.telefonos.length > 0) {
    html += `<p><b>📞 Teléfonos:</b> ${data.telefonos.map(escaparHTML).join(", ")}</p>`;
  }

  resumen.innerHTML = html;

  // Resaltar entidades en el texto
  let textoHTML = escaparHTML(data.texto);

  // Resaltar personas
  if (data.personas && data.personas.length > 0) {
    data.personas.forEach(persona => {
      const regex = new RegExp(`\\b${escaparRegex(persona)}\\b`, "gi");
      textoHTML = textoHTML.replace(regex, match => 
        `<mark class='persona'>${match}</mark>`
      );
    });
  }

  // Resaltar lugares
  if (data.lugares && data.lugares.length > 0) {
    data.lugares.forEach(lugar => {
      const regex = new RegExp(`\\b${escaparRegex(lugar)}\\b`, "gi");
      textoHTML = textoHTML.replace(regex, match => 
        `<mark class='lugar'>${match}</mark>`
      );
    });
  }

  // Resaltar emails
  if (data.emails && data.emails.length > 0) {
    data.emails.forEach(email => {
      const regex = new RegExp(escaparRegex(email), "gi");
      textoHTML = textoHTML.replace(regex, match => 
        `<mark class='email'>${match}</mark>`
      );
    });
  }

  // Resaltar fechas
  if (data.fechas && data.fechas.length > 0) {
    data.fechas.forEach(fecha => {
      const regex = new RegExp(escaparRegex(fecha), "gi");
      textoHTML = textoHTML.replace(regex, match => 
        `<mark class='fecha'>${match}</mark>`
      );
    });
  }

  textoResaltado.innerHTML = `
    <h5>📝 Texto con entidades resaltadas</h5>
    <div style="background:rgba(255,255,255,0.1); padding:15px; border-radius:10px; max-height:400px; overflow-y:auto;">
      <p style="line-height:1.8; white-space: pre-wrap;">${textoHTML}</p>
    </div>
    <small class="text-white-50 mt-2 d-block">
      <mark class='persona' style="background:#b3e5fc;color:#000;">Personas</mark> | 
      <mark class='lugar' style="background:#dcedc8;color:#000;">Lugares</mark> | 
      <mark class='email' style="background:#fff9c4;color:#000;">Emails</mark> | 
      <mark class='fecha' style="background:#ffccbc;color:#000;">Fechas</mark>
    </small>
  `;
}

// 📤 Formulario de análisis con validaciones
const formAnalisis = document.getElementById("formAnalisis");
if (formAnalisis) {
  formAnalisis.addEventListener("submit", async (e) => {
    e.preventDefault();

    const archivoInput = document.querySelector('input[name="archivo"]');
    const idiomaSelect = document.querySelector('select[name="idioma"]');
    const btnProcesar = e.target.querySelector('button[type="submit"]');
    const loader = document.getElementById("loader");

    // Validaciones
    if (!archivoInput || !archivoInput.files[0]) {
      mostrarError("⚠️ Por favor selecciona un archivo");
      return;
    }

    const archivo = archivoInput.files[0];
    if (!validarArchivo(archivo)) return;

    const idioma = idiomaSelect ? idiomaSelect.value : '';
    if (!idioma) {
      mostrarError("⚠️ Por favor selecciona un idioma");
      return;
    }

    // Mostrar loader
    if (btnProcesar) {
      btnProcesar.disabled = true;
      btnProcesar.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Procesando...';
    }
    if (loader) loader.style.display = "block";

    try {
      const formData = new FormData(e.target);
      
      // Adjuntar usuario logueado
      const usuarioSesion = JSON.parse(sessionStorage.getItem("sesionActiva") || "{}");
      if (usuarioSesion?.id) formData.append("id_usuario", usuarioSesion.id);

      const res = await fetch(`${API_URL}/analizar`, { 
        method: "POST", 
        body: formData 
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Error al procesar el análisis');
      }

      const data = await res.json();
      
      // Validar respuesta
      if (!data.idioma || typeof data.totalPalabras === 'undefined') {
        throw new Error("Respuesta inválida del servidor");
      }

      datosActuales = data;
      mostrarResultados(data);

      // Mostrar modal de envío (si existe)
      const modalElement = document.getElementById('modalEnvioReporte');
      if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
      }

    } catch (error) {
      console.error("❌ Error en análisis:", error);
      mostrarError(`❌ ${error.message || 'Error al procesar el análisis'}`);
    } finally {
      // Restaurar botón y ocultar loader
      if (btnProcesar) {
        btnProcesar.disabled = false;
        btnProcesar.innerHTML = '<i class="fas fa-bolt me-1"></i> Procesar';
      }
      if (loader) loader.style.display = "none";
    }
  });
}

// 🧹 LIMPIAR
const btnLimpiar = document.getElementById("limpiar");
if (btnLimpiar) {
  btnLimpiar.addEventListener("click", () => {
    const resumen = document.getElementById("resumen");
    const textoResaltado = document.getElementById("textoResaltado");
    const resultados = document.getElementById("resultados");
    const archivoInput = document.querySelector('input[name="archivo"]');
    const idiomaSelect = document.querySelector('select[name="idioma"]');

    if (resumen) resumen.innerHTML = "";
    if (textoResaltado) textoResaltado.innerHTML = "";
    if (resultados) resultados.style.display = "none";
    if (archivoInput) archivoInput.value = "";
    if (idiomaSelect) idiomaSelect.value = "";
    
    datosActuales = null;
    console.log("🧹 Resultados limpiados");
  });
}

// 📤 EXPORTAR PDF
const btnExportar = document.getElementById("exportar");
if (btnExportar) {
  btnExportar.addEventListener("click", async () => {
    if (!datosActuales) {
      mostrarError("⚠️ Primero procesa un archivo antes de exportar.");
      return;
    }

    try {
      btnExportar.disabled = true;
      btnExportar.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Generando...';

      const res = await fetch(`${API_URL}/generar-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultados: datosActuales })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Error generando el PDF");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analisis_${datosActuales.idioma}_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert("✅ PDF generado y descargado correctamente");
    } catch (error) {
      console.error("❌ Error al generar PDF:", error);
      mostrarError(`❌ ${error.message || 'Error al generar el PDF'}`);
    } finally {
      btnExportar.disabled = false;
      btnExportar.innerHTML = '<i class="fas fa-file-pdf me-1"></i> Exportar PDF';
    }
  });
}

// 💾 GUARDAR (mantiene funcionalidad original)
const btnGuardar = document.getElementById("guardar");
if (btnGuardar) {
  btnGuardar.addEventListener("click", () => {
    if (!datosActuales) {
      mostrarError("⚠️ Primero procesa un archivo.");
      return;
    }
    alert("✅ Análisis guardado automáticamente en la base de datos.");
  });
}

// 📧💬 ENVIAR REPORTE (función mejorada)
async function enviarReporte(medio) {
  if (!datosActuales) {
    mostrarError("⚠️ No hay datos para enviar");
    return;
  }

  const usuarioSesion = JSON.parse(sessionStorage.getItem("sesionActiva") || "{}");
  
  if (!usuarioSesion.email && (medio === 'email' || medio === 'ambos')) {
    mostrarError("❌ No hay correo electrónico asociado al usuario");
    return;
  }

  if (!usuarioSesion.telefono && (medio === 'whatsapp' || medio === 'ambos')) {
    mostrarError("❌ No hay teléfono asociado al usuario");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/enviar-reporte`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        medio: medio,
        correo: usuarioSesion.email,
        nombre: usuarioSesion.nombre_completo,
        telefono: usuarioSesion.telefono,
        resultados: datosActuales
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || 'Error al enviar el reporte');
    }

    const data = await res.json();
    
    // Cerrar modal si existe
    const modalElement = document.getElementById('modalEnvioReporte');
    if (modalElement && typeof bootstrap !== 'undefined') {
      const modalInstance = bootstrap.Modal.getInstance(modalElement);
      if (modalInstance) modalInstance.hide();
    }

    alert(`✅ Reporte enviado correctamente por ${medio}`);
    
  } catch (error) {
    console.error("❌ Error al enviar reporte:", error);
    mostrarError(`❌ ${error.message}`);
  }
}

// 📧 Botón de correo (fallback si no hay modal)
const btnCorreo = document.getElementById("btnCorreo");
if (btnCorreo) {
  btnCorreo.addEventListener("click", async () => {
    if (!datosActuales) {
      mostrarError("⚠️ Primero procesa un archivo antes de enviar.");
      return;
    }

    const usuario = JSON.parse(sessionStorage.getItem("sesionActiva") || "{}");
    if (!usuario?.email) {
      mostrarError("❌ No hay correo asociado al usuario.");
      return;
    }

    try {
      btnCorreo.disabled = true;
      btnCorreo.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Enviando...';

      const res = await fetch(`${API_URL}/enviar-correo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo: usuario.email,
          nombre: usuario.nombre_completo,
          resultados: datosActuales
        })
      });

      const data = await res.json();
      
      if (data.success) {
        alert(`✅ Correo enviado correctamente a ${usuario.email}`);
      } else {
        throw new Error(data.message || "Error al enviar correo");
      }
    } catch (err) {
      console.error("❌ Error:", err);
      mostrarError(`❌ ${err.message || 'Error al enviar el correo'}`);
    } finally {
      btnCorreo.disabled = false;
      btnCorreo.innerHTML = '<i class="fas fa-envelope me-2"></i> Enviar a correo';
    }
  });
}

// 💬 Botón de WhatsApp (preparado para implementación)
const btnWhatsApp = document.getElementById("btnWhatsApp");
if (btnWhatsApp) {
  btnWhatsApp.addEventListener("click", () => {
    if (!datosActuales) {
      mostrarError("⚠️ Primero procesa un archivo antes de enviar.");
      return;
    }

    const usuario = JSON.parse(sessionStorage.getItem("sesionActiva") || "{}");
    if (!usuario?.telefono) {
      mostrarError("❌ No hay teléfono asociado al usuario.");
      return;
    }

    // Por ahora muestra alerta, puedes implementar enviarReporte('whatsapp')
    alert("💬 Funcionalidad de WhatsApp en desarrollo.\nTeléfono registrado: " + usuario.telefono);
  });
}

// ===============================
// 🔐 SISTEMA DE LOGIN MEJORADO
// ===============================

// Login con QR
const params = new URLSearchParams(window.location.search);
const codigoQR = params.get("codigo");

if (codigoQR) {
  const infoUsuario = document.getElementById("info-usuario");
  if (infoUsuario) {
    infoUsuario.style.display = "block";
    infoUsuario.className = "alert alert-info text-center";
    infoUsuario.innerHTML = `<b>🔍 Verificando identidad con QR...</b>`;

    fetch(`${API_URL}/api/login-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: codigoQR })
    })
    .then(res => {
      if (!res.ok) throw new Error("Error en la respuesta del servidor");
      return res.json();
    })
    .then(data => {
      if (data.success) {
        sessionStorage.setItem("sesionActiva", JSON.stringify(data.usuario));
        if (data.usuario.token) {
          sessionStorage.setItem("token", data.usuario.token);
        }
        mostrarPanelAnalizador(data.usuario);
      } else {
        infoUsuario.classList.replace("alert-info","alert-danger");
        infoUsuario.innerHTML = "❌ Código QR inválido o no registrado.";
      }
    })
    .catch(err => {
      console.error("Error en login QR:", err);
      infoUsuario.className = "alert alert-danger text-center";
      infoUsuario.innerText = "⚠️ Error al conectar con servidor.";
    });
  }
} else {
  // Verificar sesión existente
  const sesion = sessionStorage.getItem("sesionActiva");
  if (sesion) {
    try {
      const user = JSON.parse(sesion);
      mostrarPanelAnalizador(user);
    } catch (err) {
      console.error("Error al parsear sesión:", err);
      sessionStorage.removeItem("sesionActiva");
    }
  } else {
    // Mostrar opción de login facial
    const infoUsuario = document.getElementById("info-usuario");
    if (infoUsuario) {
      infoUsuario.style.display = "block";
      infoUsuario.className = "alert alert-warning text-center";
      infoUsuario.innerHTML = `⚠️ No hay sesión activa.<br>
        <button id="btnLoginFace" class="btn btn-primary mt-3">
          <i class="fas fa-camera me-2"></i> Iniciar con reconocimiento facial
        </button>`;
    }
  }
}

// 📷 Login por reconocimiento facial mejorado
document.addEventListener("click", (e) => {
  if (e.target.id === "btnLoginFace" || e.target.closest('#btnLoginFace')) {
    iniciarReconocimientoFacialLogin();
  }
});

async function iniciarReconocimientoFacialLogin() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    mostrarError("❌ Tu navegador no soporta reconocimiento facial. Use Chrome o Firefox.");
    return;
  }

  const seccionFacial = document.getElementById("seccion-facial");
  const video = document.getElementById("videoPreview");
  const infoUsuario = document.getElementById("info-usuario");

  if (!seccionFacial || !video) {
    console.error("Elementos de video no encontrados");
    return;
  }

  try {
    seccionFacial.style.display = "block";
    streamActual = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = streamActual;
    video.style.display = "block";

    const btnCapturar = document.getElementById("btnCapturarRostro");
    if (btnCapturar) {
      btnCapturar.onclick = async () => {
        btnCapturar.disabled = true;
        btnCapturar.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Verificando...';

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const imageData = canvas.toDataURL("image/jpeg");

        try {
          const res = await fetch(`${API_URL}/api/login-face`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imagen: imageData })
          });

          if (!res.ok) {
            throw new Error("Error en el servidor");
          }

          const data = await res.json();

          if (data.success) {
            sessionStorage.setItem("sesionActiva", JSON.stringify(data.usuario));
            if (data.usuario.token) {
              sessionStorage.setItem("token", data.usuario.token);
            }
            mostrarPanelAnalizador(data.usuario);
            detenerCamaraLogin();
          } else {
            if (infoUsuario) {
              infoUsuario.className = "alert alert-danger text-center";
              infoUsuario.innerText = "❌ No se reconoció el rostro. Intenta de nuevo.";
            }
            mostrarError("❌ Rostro no reconocido");
          }
        } catch (err) {
          console.error("Error en reconocimiento facial:", err);
          mostrarError("❌ Error al procesar reconocimiento facial");
        } finally {
          btnCapturar.disabled = false;
          btnCapturar.innerHTML = '<i class="fas fa-camera me-2"></i> Verificar rostro';
        }
      };
    }
  } catch (error) {
    console.error("Error accediendo a cámara:", error);
    mostrarError("❌ No se pudo acceder a la cámara. Verifica los permisos.");
    if (seccionFacial) seccionFacial.style.display = "none";
  }
}

function detenerCamaraLogin() {
  const video = document.getElementById("videoPreview");
  const seccionFacial = document.getElementById("seccion-facial");

  if (streamActual) {
    streamActual.getTracks().forEach(track => track.stop());
    streamActual = null;
  }
  
  if (video) {
    video.srcObject = null;
    video.style.display = "none";
  }
  
  if (seccionFacial) {
    seccionFacial.style.display = "none";
  }
  
  console.log("🛑 Cámara de login detenida");
}

function mostrarPanelAnalizador(user) {
  const infoUsuario = document.getElementById("info-usuario");
  const panelAnalizador = document.getElementById("panelAnalizador");

  if (infoUsuario) {
    infoUsuario.className = "alert alert-success text-center";
    infoUsuario.innerHTML = `✅ Bienvenido <b>${escaparHTML(user.nombre_completo || 'Usuario')}</b>`;
    infoUsuario.style.display = "block";
  }

  if (panelAnalizador) {
    panelAnalizador.style.display = "block";
  }

  console.log("✅ Panel del analizador mostrado para:", user.nombre_completo);
}

// 🔒 Cerrar sesión
const btnCerrarSesion = document.getElementById("cerrar-sesion");
if (btnCerrarSesion) {
  btnCerrarSesion.addEventListener("click", () => {
    // Confirmar cierre de sesión
    if (confirm("¿Estás seguro de que deseas cerrar sesión?")) {
      sessionStorage.removeItem("sesionActiva");
      sessionStorage.removeItem("token");
      
      // Detener cámara si está activa
      if (streamActual) {
        streamActual.getTracks().forEach(track => track.stop());
        streamActual = null;
      }
      
      console.log("🔒 Sesión cerrada");
      window.location.href = "home.html";
    }
  });
}

// ===============================
// 🛡️ PROTECCIÓN CONTRA RECARGA
// ===============================
window.addEventListener('beforeunload', (e) => {
  // Detener cámara si está activa
  if (streamActual) {
    streamActual.getTracks().forEach(track => track.stop());
  }
  
  // Si hay datos sin guardar, advertir al usuario
  if (datosActuales && !confirm("¿Estás seguro? Los resultados del análisis se perderán.")) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ===============================
// 📱 COMPATIBILIDAD MÓVIL
// ===============================
function detectarDispositivo() {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    console.log("📱 Dispositivo móvil detectado");
    // Ajustar estilos para móvil si es necesario
    document.body.classList.add('mobile-device');
  }
}

detectarDispositivo();

// ===============================
// 🔄 VERIFICACIÓN DE CONEXIÓN
// ===============================
function verificarConexion() {
  if (!navigator.onLine) {
    mostrarError("⚠️ Sin conexión a Internet. Algunas funciones pueden no estar disponibles.");
  }
}

window.addEventListener('online', () => {
  console.log("✅ Conexión a Internet restaurada");
});

window.addEventListener('offline', () => {
  mostrarError("⚠️ Se perdió la conexión a Internet");
});

verificarConexion();

// ===============================
// 🎯 INICIALIZACIÓN FINAL
// ===============================
console.log("✅ Script del analizador léxico cargado correctamente");
console.log("📍 API URL:", API_URL);
console.log("🔧 Device Code:", DEVICE_CODE);

// Verificar elementos críticos del DOM
const elementosCriticos = [
  'formAnalisis',
  'resumen',
  'resultados',
  'textoResaltado'
];

elementosCriticos.forEach(id => {
  const elemento = document.getElementById(id);
  if (!elemento) {
    console.warn(`⚠️ Elemento crítico no encontrado: ${id}`);
  }
});

// ===============================
// 🧪 MODO DEBUG (desactivar en producción)
// ===============================
const DEBUG_MODE = false; // Cambiar a false en producción

if (DEBUG_MODE) {
  console.log("🐛 Modo debug activado");
  
  // Exponer funciones globalmente para testing
  window.debug = {
    datosActuales: () => datosActuales,
    mostrarError,
    validarArchivo,
    enviarReporte,
    API_URL
  };
}

// ===============================
// 📊 ANALYTICS (opcional)
// ===============================
function registrarEvento(accion, categoria = 'Analizador') {
  console.log(`📊 Evento: ${categoria} - ${accion}`);
  // Aquí puedes integrar Google Analytics, Mixpanel, etc.
  // Ejemplo: gtag('event', accion, { 'event_category': categoria });
}

// Ejemplos de uso:
// registrarEvento('archivo_procesado', 'Analizador');
// registrarEvento('pdf_generado', 'Exportar');
// registrarEvento('reporte_enviado', 'Notificaciones');

// ===============================
// 🎨 TEMAS (opcional)
// ===============================
function cambiarTema(tema) {
  document.body.setAttribute('data-theme', tema);
  localStorage.setItem('tema-preferido', tema);
  console.log(`🎨 Tema cambiado a: ${tema}`);
}

// Cargar tema guardado
const temaGuardado = localStorage.getItem('tema-preferido');
if (temaGuardado) {
  cambiarTema(temaGuardado);
}

// ===============================
// ⚡ OPTIMIZACIONES DE RENDIMIENTO
// ===============================

// Debounce para búsquedas
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle para eventos frecuentes
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

// ===============================
// 🔐 SEGURIDAD ADICIONAL
// ===============================

// Prevenir inyección de HTML en inputs
function sanitizarInput(input) {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

// Validar token JWT (si lo implementas)
function validarToken() {
  const token = sessionStorage.getItem("token");
  if (!token) return false;
  
  try {
    // Decodificar JWT (requiere librería jwt-decode)
    // const decoded = jwt_decode(token);
    // const ahora = Date.now() / 1000;
    // return decoded.exp > ahora;
    return true; // Implementar correctamente en producción
  } catch (err) {
    console.error("Error validando token:", err);
    return false;
  }
}

// Renovar token automáticamente
function renovarTokenAutomatico() {
  setInterval(() => {
    if (validarToken()) {
      console.log("🔐 Token válido");
    } else {
      console.warn("⚠️ Token expirado, renovando...");
      // Implementar lógica de renovación
    }
  }, 5 * 60 * 1000); // Cada 5 minutos
}

// Iniciar renovación automática si hay sesión
if (sessionStorage.getItem("sesionActiva")) {
  // renovarTokenAutomatico(); // Descomentar cuando implementes JWT
}

// ===============================
// 📝 REGISTRO DE ACTIVIDAD (Logs)
// ===============================
const activityLog = [];

function registrarActividad(tipo, detalles) {
  const registro = {
    timestamp: new Date().toISOString(),
    tipo,
    detalles,
    usuario: JSON.parse(sessionStorage.getItem("sesionActiva") || '{}').nombre_completo || 'Anónimo'
  };
  
  activityLog.push(registro);
  console.log("📝 Actividad registrada:", registro);
  
  // Limitar tamaño del log
  if (activityLog.length > 100) {
    activityLog.shift();
  }
}

// Ejemplo de uso:
// registrarActividad('ANALISIS_REALIZADO', { idioma: 'español', palabras: 150 });

// =============================================
// 🧪 MODO DESARROLLADOR AUTOMÁTICO (solo localhost)
// =============================================
document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("panelAnalizador");
  const info = document.getElementById("info-usuario");
  const esLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (esLocal && panel) {
    const sesionFake = {
      id: 1,
      nombre_completo: "Usuario Local de Prueba",
      email: "local@umg.edu.gt",
      telefono: "55555555",
      token: "fake_token_local"
    };
    sessionStorage.setItem("sesionActiva", JSON.stringify(sesionFake));

    panel.style.display = "block";
    if (info) {
      info.className = "alert alert-success text-center";
      info.innerHTML = `✅ Bienvenido <b>${sesionFake.nombre_completo}</b> (modo desarrollador)`;
      info.style.display = "block";
    }
    console.log("🧪 Analizador activado automáticamente (modo local).");
  }
});

// ===============================
// 🚀 EXPORTAR FUNCIONES GLOBALES
// ===============================
window.analizadorUMG = {
  version: '2.0.0',
  enviarReporte,
  mostrarError,
  validarArchivo,
  registrarActividad,
  cambiarTema
};

console.log("🎉 Sistema de Analizador Léxico UMG v2.0 inicializado correctamente");