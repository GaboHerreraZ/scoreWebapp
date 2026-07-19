// Topes de tamaño para archivos subidos vía multipart (multer usa memory
// storage: el archivo entero vive en RAM durante el request, así que estos
// límites acotan directamente el consumo de memoria por upload). Al excederse,
// multer corta con LIMIT_FILE_SIZE y Nest responde 413 Payload Too Large.

/** Imágenes (logos, avatares, portadas de blog). */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

/** PDFs de estados financieros para extracción con IA. */
export const MAX_PDF_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
