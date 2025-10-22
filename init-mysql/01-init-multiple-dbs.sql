CREATE DATABASE IF NOT EXISTS analizador_db;
USE analizador_db;

CREATE TABLE IF NOT EXISTS analisis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_archivo VARCHAR(255),
  idioma VARCHAR(10),
  total_palabras INT,
  total_caracteres INT,
  palabras_unicas INT,
  densidad_lexica DECIMAL(5,2),
  top_palabras TEXT,
  menos_frecuentes TEXT,
  pronombres TEXT,
  personas TEXT,
  lugares TEXT,
  sustantivos TEXT,
  verbos TEXT,
  numeros TEXT,
  correos TEXT,
  telefonos TEXT,
  fecha_analisis TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
