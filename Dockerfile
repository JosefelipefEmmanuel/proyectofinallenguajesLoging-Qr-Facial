# ================================
# 🧱 Etapa base con dependencias del sistema
# ================================
FROM node:20 AS base

# Instala dependencias necesarias para canvas, puppeteer, face-api.js y Python
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libvips-dev \
    libglib2.0-dev \
    python3 \
    python3-pip \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Define el directorio de trabajo
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala dependencias base (incluye express-session si faltaba)
RUN npm install express-session && npm install

# Copia el resto del código
COPY . .

# Expone el puerto
EXPOSE 3000


# ================================
# 🧑‍💻 Etapa de desarrollo
# ================================
FROM base AS development
ENV NODE_ENV=development

# Instala nodemon globalmente dentro del contenedor
RUN npm install -g nodemon

# Usa nodemon para autorecargar los cambios
CMD ["nodemon", "server.js"]


# ================================
# 🚀 Etapa de producción
# ================================
FROM base AS production
ENV NODE_ENV=production

# Limpieza: elimina dependencias innecesarias
RUN npm prune --omit=dev

# Comando de ejecución estándar
CMD ["npm", "start"]
