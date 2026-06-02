import { CustomTerm, Character, Relationship } from "../types";

type SheetDataType = 'vocab' | 'char' | 'rel';

// --- DATA MAPPING HELPERS ---

// Map raw sheet rows to App Types
const mapRowsToData = (type: SheetDataType, rows: any[]): any[] => {
  if (type === 'vocab') {
    return rows.map((row, i) => ({
      id: row[0] ? row[0].toString() : `auto_v_${Date.now()}_${i}`,
      term: row[1]?.toString() || "",
      meaning: row[2]?.toString() || ""
    })).filter((i: any) => i.term);
  }
  
  if (type === 'char') {
    return rows.map((row, i) => ({
      id: row[0] ? row[0].toString() : `auto_c_${Date.now()}_${i}`,
      chineseName: row[1]?.toString() || "",
      vietName: row[2]?.toString() || "",
      pronouns: row[3]?.toString() || "",
      description: row[4]?.toString() || ""
    })).filter((i: any) => i.chineseName);
  }

  if (type === 'rel') {
    return rows.map((row, i) => ({
      id: row[0] ? row[0].toString() : `auto_r_${Date.now()}_${i}`,
      charA: row[1]?.toString() || "",
      charB: row[2]?.toString() || "",
      callAtoB: row[3]?.toString() || "",
      callBtoA: row[4]?.toString() || "",
      note: row[5]?.toString() || ""
    })).filter((i: any) => i.charA && i.charB);
  }
  return [];
};

// Map App Types to Sheet Rows (Array of Arrays)
const mapDataToRows = (type: SheetDataType, data: any[]): any[][] => {
  if (type === 'vocab') {
    return (data as CustomTerm[]).map(t => [t.id, t.term, t.meaning]);
  }
  if (type === 'char') {
    return (data as Character[]).map(c => [c.id, c.chineseName, c.vietName, c.pronouns, c.description]);
  }
  if (type === 'rel') {
    return (data as Relationship[]).map(r => [r.id, r.charA, r.charB, r.callAtoB, r.callBtoA, r.note]);
  }
  return [];
};

// --- API CALLS ---

export const syncSheetData = async <T>(
  scriptUrl: string, 
  type: SheetDataType, 
  action: 'GET' | 'POST', 
  payload?: T[]
): Promise<T[]> => {
  try {
    // Construct URL with type parameter for GET requests
    const url = new URL(scriptUrl);
    url.searchParams.append('type', type);

    const options: RequestInit = {
      method: action,
      redirect: 'follow',
    };

    if (action === 'POST' && payload) {
      // For POST, we send type inside the body or wrapper, 
      // but standard GAS doPost reads the body content.
      // We will wrap the data to include the type meta-data for the script.
      options.body = JSON.stringify({
        type: type,
        data: mapDataToRows(type, payload)
      });
    }

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (action === 'GET') {
      if (!Array.isArray(result)) {
         // Handle case where script returns {result: 'error'}
         throw new Error("Dữ liệu trả về không đúng định dạng.");
      }
      return mapRowsToData(type, result) as T[];
    } else {
       if (result.result !== 'success') {
         throw new Error('Script returned error.');
       }
       return payload || [];
    }

  } catch (error: any) {
    console.error(`Error syncing ${type}:`, error);
    throw new Error(`Lỗi đồng bộ (${type}): ${error.message || "Lỗi kết nối"}`);
  }
};

// Legacy Wrappers (Optional, but kept for compatibility if needed elsewhere)
export const fetchTermsFromSheet = (url: string) => syncSheetData<CustomTerm>(url, 'vocab', 'GET');
export const saveTermsToSheet = (url: string, data: CustomTerm[]) => syncSheetData<CustomTerm>(url, 'vocab', 'POST', data);
