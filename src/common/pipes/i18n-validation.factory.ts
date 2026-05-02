import { BadRequestException, ValidationError } from '@nestjs/common';

const propertyLabels: Record<string, string> = {
  // Identificación / cliente
  businessName: 'Razón social',
  identificationNumber: 'Número de identificación',
  identificationTypeId: 'Tipo de identificación',
  personTypeId: 'Tipo de persona',
  economicActivityId: 'Actividad económica',
  seniority: 'Antigüedad',

  // Representante legal
  legalRepName: 'Nombre del representante legal',
  legalRepId: 'Identificación del representante legal',
  legalRepIdentificationTypeId: 'Tipo de identificación del representante legal',
  legalRepEmail: 'Correo del representante legal',
  legalRepPhone: 'Teléfono del representante legal',

  // Contacto
  email: 'Correo electrónico',
  phone: 'Teléfono',
  secondaryPhone: 'Teléfono secundario',
  city: 'Ciudad',
  state: 'Departamento',
  address: 'Dirección',

  // Referencias comerciales
  commercialRef1Name: 'Nombre referencia comercial 1',
  commercialRef1Contact: 'Contacto referencia comercial 1',
  commercialRef1Phone: 'Teléfono referencia comercial 1',
  commercialRef2Name: 'Nombre referencia comercial 2',
  commercialRef2Contact: 'Contacto referencia comercial 2',
  commercialRef2Phone: 'Teléfono referencia comercial 2',
  observations: 'Observaciones',

  // Empresa / suscripción
  name: 'Nombre',
  subscriptionId: 'Suscripción',
  sectorId: 'Sector',
  companyId: 'Empresa',
  customerId: 'Cliente',
  userId: 'Usuario',
  roleId: 'Rol',

  // Estudio de crédito
  studyDate: 'Fecha del estudio',
  resolutionDate: 'Fecha de resolución',
  requestedTerm: 'Plazo solicitado',
  requestedCreditLine: 'Cupo solicitado',
  balanceSheetDate: 'Fecha del balance',
  incomeStatementId: 'Periodo del estado de resultados',
  notes: 'Notas',

  // Comunes
  page: 'Página',
  limit: 'Límite',
  search: 'Búsqueda',
  password: 'Contraseña',
  title: 'Título',
  message: 'Mensaje',
};

const labelFor = (path: string): string => {
  // Para paths anidados (ej "items.0.email") se usa el último segmento
  // como clave de búsqueda; si no hay match, se devuelve el path completo.
  const last = path.split('.').pop() ?? path;
  return propertyLabels[last] ?? path;
};

type Translator = (property: string, constraintValue?: string) => string;

const translators: Record<string, Translator> = {
  // Texto / longitud
  isString: (p) => `${p} debe ser un texto.`,
  isNotEmpty: (p) => `${p} es obligatorio.`,
  maxLength: (p, v) => `${p} no puede superar ${v} caracteres.`,
  minLength: (p, v) => `${p} debe tener al menos ${v} caracteres.`,
  length: (p, v) => `${p} debe tener una longitud válida (${v}).`,
  matches: (p) => `${p} tiene un formato no válido.`,

  // Números
  isInt: (p) => `${p} debe ser un número entero.`,
  isNumber: (p) => `${p} debe ser un número.`,
  isPositive: (p) => `${p} debe ser un número positivo.`,
  isNegative: (p) => `${p} debe ser un número negativo.`,
  min: (p, v) => `${p} debe ser mayor o igual a ${v}.`,
  max: (p, v) => `${p} debe ser menor o igual a ${v}.`,

  // Booleano / enum / arrays
  isBoolean: (p) => `${p} debe ser verdadero o falso.`,
  isEnum: (p) => `${p} tiene un valor no permitido.`,
  isArray: (p) => `${p} debe ser una lista.`,
  arrayMinSize: (p, v) => `${p} debe contener al menos ${v} elementos.`,
  arrayMaxSize: (p, v) => `${p} no puede contener más de ${v} elementos.`,

  // Fechas
  isDate: (p) => `${p} debe ser una fecha válida.`,
  isDateString: (p) => `${p} debe ser una fecha válida (formato ISO).`,

  // Identificadores y formatos
  isUUID: (p) => `${p} debe ser un identificador UUID válido.`,
  isEmail: (p) => `${p} debe ser un correo electrónico válido.`,
  isUrl: (p) => `${p} debe ser una URL válida.`,
  isPhoneNumber: (p) => `${p} debe ser un número de teléfono válido.`,
  isJSON: (p) => `${p} debe ser un JSON válido.`,

  // Objetos
  isObject: (p) => `${p} debe ser un objeto.`,
  isDefined: (p) => `${p} es obligatorio.`,

  // Whitelist
  whitelistValidation: (p) => `${p} no está permitido.`,
};

const getConstraintValue = (
  error: ValidationError,
  key: string,
): string | undefined => {
  const ctx = error.contexts?.[key];
  if (ctx && typeof ctx === 'object' && 'value' in ctx) {
    return String((ctx as { value: unknown }).value);
  }
  return undefined;
};

const translate = (
  error: ValidationError,
  path: string,
  key: string,
  defaultMsg: string,
): string => {
  const translator = translators[key];
  if (!translator) return defaultMsg;
  return translator(path, getConstraintValue(error, key));
};

const flatten = (errors: ValidationError[], parent = ''): string[] => {
  const out: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;

    if (error.constraints) {
      const label = labelFor(path);
      for (const [key, defaultMsg] of Object.entries(error.constraints)) {
        out.push(translate(error, label, key, defaultMsg));
      }
    }

    if (error.children?.length) {
      out.push(...flatten(error.children, path));
    }
  }
  return out;
};

export const i18nValidationExceptionFactory = (errors: ValidationError[]) =>
  new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: flatten(errors),
  });
