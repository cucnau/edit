
export interface VocabItem {
  term: string;
  pinyin: string;
  hanViet: string;
  meaning: string;
  explanation: string;
}

export interface TranslationSegment {
  source: string; // Text gốc tiếng Trung của đoạn này
  natural: string;
  quick: string;
  deepl: string;
}

export interface TranslationResponse {
  naturalTranslation: string; // Full text merged
  quickTrans: string;         // Full text merged
  sinoVietnamese: string;
  deeplTranslation: string;     // Full text merged
  segments: TranslationSegment[]; // Array for Table View
  vocabulary: VocabItem[];
}

export interface Novel {
  id: string;
  name: string;
}

export interface CustomTerm {
  id: string;
  novelId: string;
  term: string;
  meaning: string;
}

export interface Character {
  id: string;
  novelId: string;
  chineseName: string; // Trung
  vietName: string;    // Tên Việt
  pronouns: string;    // ĐTNX (Đại từ nhân xưng - Ngôi 3)
  description: string; // Chi tiết
}

export interface Relationship {
  id: string;
  novelId: string;
  charA: string;    // Nhân vật A
  charB: string;    // Nhân vật B
  callAtoB: string; // A gọi B
  callBtoA: string; // B gọi A
  note: string;     // Ghi chú
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  sourceText: string;
  result: TranslationResponse;
  modelId?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export interface TranslationSession {
  id: string;
  name: string;
  inputText: string;
  deeplText: string;
  status: AppStatus;
  result: TranslationResponse | null;
  error: string | null;
  modelId: string; // Model AI được chọn cho session này
  currentHistoryId?: string; // Liên kết với bản ghi lịch sử
  
  // Data
  customTerms: CustomTerm[];
  sheetUrl: string;
  currentNovelId?: string;
  
  // World Info (Table Data)
  characters: Character[];
  relationships: Relationship[];
  
  notes: string; // Scratchpad
  completedSegments: number[]; // Lưu danh sách index các đoạn đã làm xong
}
