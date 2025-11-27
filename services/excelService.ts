import * as XLSX from 'xlsx';
import { PodioItem, PodioField } from '../types';

export const generateExcelData = (items: PodioItem[]): Uint8Array => {
  if (items.length === 0) return new Uint8Array();

  // 1. Identificar todas las columnas posibles (headers) dinámicamente
  const allHeaders = new Set<string>();
  allHeaders.add('Item ID');
  allHeaders.add('App Item ID');
  allHeaders.add('Title');
  allHeaders.add('Created On');
  allHeaders.add('Files Attached');

  // Recorrer items para encontrar todos los nombres de campos únicos
  items.forEach(item => {
    item.fields.forEach(field => {
      allHeaders.add(field.label);
    });
  });

  const headersArray = Array.from(allHeaders);

  // 2. Mapear datos a filas
  const data = items.map(item => {
    const row: any = {
      'Item ID': item.item_id,
      'App Item ID': item.app_item_id,
      'Title': item.title,
      'Created On': item.created_on,
      'Files Attached': item.files.map(f => f.name).join(', ')
    };

    item.fields.forEach(field => {
        // Lógica simple para extraer valor como string
        let valStr = '';
        if (field.type === 'app') {
             valStr = field.values.map((v: any) => v.value.title || v.value.app_item_id).join('; ');
        } else if (field.type === 'category') {
             valStr = field.values.map((v: any) => v.value.text || v.value.id).join('; ');
        } else if (field.type === 'date') {
             valStr = field.values.map((v: any) => v.start + (v.end ? ' - ' + v.end : '')).join('; ');
        } else if (field.type === 'contact') {
             valStr = field.values.map((v: any) => v.value.name).join('; ');
        } else {
             // Fallback para texto, números, etc.
             valStr = field.values.map((v: any) => typeof v.value === 'object' ? JSON.stringify(v.value) : v.value).join('; ');
        }
        row[field.label] = valStr;
    });

    return row;
  });

  // 3. Crear hoja de cálculo
  const worksheet = XLSX.utils.json_to_sheet(data, { header: headersArray });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Podio Data");

  // 4. Escribir a buffer
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(excelBuffer);
};
