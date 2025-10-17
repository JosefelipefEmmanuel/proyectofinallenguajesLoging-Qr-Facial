import pywhatkit
import sys
import time
import socket

# ============================
# Script para enviar mensajes de WhatsApp (modo automático)
# Detecta si se ejecuta en local o servidor UMG
# ============================

DOMINIO_PUBLICO = "https://seguridadglobalumg.com"

def es_localhost():
    try:
        nombre_host = socket.gethostname()
        ip_local = socket.gethostbyname(nombre_host)
        return ip_local.startswith("127.") or ip_local.startswith("192.")
    except:
        return True

if len(sys.argv) < 4:
    print(" Uso correcto: python send_whatsapp.py <numero> <nombre> <codigo>")
    sys.exit(1)

numero = sys.argv[1]
nombre = sys.argv[2]
codigo = sys.argv[3]

if es_localhost():
    base_url = "http://localhost:3000/uploads"
    modo = " Modo local detectado"
else:
    base_url = f"{DOMINIO_PUBLICO}/uploads"
    modo = "🌐 Modo servidor detectado"

print(modo)
print(f"Preparando envío de mensaje a {numero}...\n")

mensaje = f"""Universidad Mariano Gálvez de Guatemala
Hola {nombre}, tu carné digital UMG ha sido generado correctamente.

Código: {codigo}

Puedes descargar tus versiones aquí:
Carné normal: {base_url}/{codigo}_normal.pdf
Carné con filtro: {base_url}/{codigo}_filtro.pdf

Gracias por formar parte de la comunidad UMG.
"""

time.sleep(3)
try:
    pywhatkit.sendwhatmsg_instantly(
        numero,
        mensaje,
        wait_time=10,
        tab_close=True,
        close_time=3
    )
    print(f" Mensaje enviado correctamente a {numero}")
except Exception as e:
    print(f" Error al enviar mensaje: {e}")

print("Proceso finalizado.")
