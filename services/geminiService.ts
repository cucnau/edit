
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { TranslationResponse, CustomTerm, Character, Relationship } from "../types";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || "" });

// Danh sách các model ưu tiên thử nghiệm theo thứ tự khi gặp lỗi
const FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview'
];

// --- CONFIGURATION ---
const MIN_REQUEST_INTERVAL = 1000; 

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
];

const translationSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      description: "Danh sách các đoạn văn ứng với từng dòng của văn bản gốc.",
      items: {
        type: Type.OBJECT,
        properties: {
            lineIndex: { type: Type.INTEGER, description: "Số thứ tự dòng tương ứng (1-indexed). Ví dụ dòng [L1] thì lineIndex là 1, dòng [L2] là 2." },
            source: { type: Type.STRING, description: "Nguyên văn dòng gốc." },
            natural: { type: Type.STRING, description: "Bản dịch mượt." },
            quick: { type: Type.STRING, description: "Dịch word-by-word." }
        },
        required: ["lineIndex", "source", "natural", "quick"]
      }
    },
    sinoVietnamese: { type: Type.STRING },
    vocabulary: {
      type: Type.ARRAY,
      description: "Danh sách từ vựng quan trọng.",
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          pinyin: { type: Type.STRING },
          hanViet: { type: Type.STRING },
          meaning: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ["term", "pinyin", "hanViet", "meaning", "explanation"],
      },
    },
  },
  required: ["segments", "sinoVietnamese", "vocabulary"],
};

let lastRequestTime = 0;
const waitForQuota = async () => {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLast));
  }
  lastRequestTime = Date.now();
};

const cleanJsonString = (str: string) => {
  return str
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim();
};

const performApiCallWithFallback = async (prompt: string): Promise<TranslationResponse & { modelUsed: string }> => {
    let lastError: any = null;
    const maxRetriesPerModel = 2; // Try up to 3 times per model
    
    const modelsToTry = [...FALLBACK_MODELS];
    
    for (const modelId of modelsToTry) {
        let retries = 0;
        
        while (retries <= maxRetriesPerModel) {
            try {
                await waitForQuota();
                const response = await ai.models.generateContent({
                    model: modelId,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: translationSchema,
                        safetySettings: SAFETY_SETTINGS,
                        temperature: 0.1,
                    },
                });

                const text = response.text;
                if (!text) throw new Error("AI không phản hồi");
                
                const cleaned = cleanJsonString(text);
                const parsed = JSON.parse(cleaned) as TranslationResponse;
                return { ...parsed, modelUsed: modelId };
            } catch (e: any) {
                const message = e?.message || "";
                console.warn(`Model ${modelId} thất bại (Lần ${retries + 1}):`, message);
                lastError = e;
                
                const isOverloaded = message.includes("503") || message.includes("429") || message.includes("high demand") || message.includes("UNAVAILABLE") || message.includes("quota");
                
                if (isOverloaded && retries < maxRetriesPerModel) {
                    const waitTime = Math.pow(2, retries) * 2000; // 2s, 4s
                    console.log(`Đang bị quá tải. Đợi ${waitTime}ms trước khi thử lại...`);
                    await new Promise(r => setTimeout(r, waitTime));
                    retries++;
                } else {
                    // Nếu lỗi khác (hoặc hết lượt retry của model này) thì chuyển sang model khác
                    await new Promise(r => setTimeout(r, 1000));
                    break;
                }
            }
        }
    }
    
    if (lastError?.message?.includes("Unterminated string") || lastError?.message?.includes("Unexpected end")) {
        throw new Error("Văn bản quá dài khiến AI bị quá tải dữ liệu. Hãy chia nhỏ văn bản (tầm 15-20 dòng) để AI dịch đầy đủ nhất.");
    }
    
    if (lastError?.message?.includes("503") || lastError?.message?.includes("high demand")) {
       throw new Error("Hệ thống AI đang quá tải do có nhiều người cùng sử dụng lúc này. Bạn thử ấn dịch lại lần nữa nhé!");
    }
    
    throw new Error(lastError?.message || "Tất cả các model AI đều không thể phản hồi lúc này.");
};

export const translateText = async (
  text: string, 
  customDictionary: CustomTerm[] = [],
  characters: Character[] = [],
  relationships: Relationship[] = []
): Promise<TranslationResponse & { modelUsed: string }> => {
  if (!text.trim()) throw new Error("Vui lòng nhập văn bản.");

  const inputLines = text.split('\n');
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentCharCount = 0;

  for (const line of inputLines) {
    if (currentChunk.length >= 30 || currentCharCount + line.length > 2000) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentCharCount = 0;
      }
    }
    currentChunk.push(line);
    currentCharCount += line.length;
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  let allSegments: any[] = [];
  let allVocabulary: any[] = [];
  let allSinoVietnamese = "";
  let firstModelUsed = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunkLines = chunks[i];
    const chunkLineCount = chunkLines.length;
    const chunkCharCount = chunkLines.reduce((acc, line) => acc + line.length, 0);

    const vocabTarget = Math.max(5, Math.min(40, Math.floor(chunkCharCount / 40)));

    const contextPrompt = `Bạn là chuyên gia dịch thuật Trung-Việt cho tiểu thuyết.
YÊU CẦU NGHIÊM NGẶT VỀ CẤU TRÚC:
1. Văn bản này có đúng CHÍNH XÁC ${chunkLineCount} dòng, được đánh dấu từ [L1] đến [L${chunkLineCount}]. Bạn PHẢI dịch từng dòng độc lập và trả về mảng "segments" chứa bản dịch tương ứng.
2. Với mỗi segment, bạn PHẢI gán đúng "lineIndex" tương ứng với số thứ tự của dòng gốc trong khối văn bản này (từ 1 đến ${chunkLineCount}). Ví dụ: dòng [L1] có lineIndex là 1, dòng [L2] có lineIndex là 2.
3. Mỗi dòng gốc (từ [L1] đến [L${chunkLineCount}]) PHẢI tương ứng với ĐÚNG 1 phần tử (segment) duy nhất trong mảng "segments", có "lineIndex" tương ứng. TUYỆT ĐỐI KHÔNG ĐƯỢC phép tách một dòng gốc thành nhiều segment nhỏ hơn trong mảng, và TUYỆT ĐỐI KHÔNG ĐƯỢC gộp nhiều dòng gốc vào chung một segment. Bản dịch của toàn bộ dòng gốc đó phải nằm trọn vẹn trong thuộc tính "natural" của segment đó.
4. Nếu dòng gốc trống, segment tương ứng vẫn phải tồn tại trong "segments" với "natural" và "quick" rỗng.
5. Dựa trên độ dài văn bản (${chunkCharCount} ký tự), trích xuất khoảng ${vocabTarget} từ vựng vào mảng "vocabulary". 
   ƯU TIÊN TRÍCH XUẤT TRIỆT ĐỂ: Bạn PHẢI quét toàn bộ văn bản và đưa TẤT CẢ các tên riêng (nhân vật chưa có trong danh sách, địa danh, môn phái, chiêu thức, vật phẩm đặc thù) vào vocabulary để người dùng tra cứu. Không được bỏ sót bất kỳ thực thể danh từ riêng nào.

YÊU CẦU BẮT BUỘC VỀ DỊCH THUẬT (PHẢI TUÂN THỦ 100%):
1. Bạn PHẢI sử dụng ĐÚNG các từ vựng, tên nhân vật, đại từ nhân xưng và quy tắc xưng hô được cung cấp dưới đây trong bản dịch "natural". Nếu vi phạm, bản dịch sẽ bị coi là lỗi nghiêm trọng.
2. NGUYÊN TẮC DẤU NGOẶC:
- Nếu dòng gốc dùng cặp dấu ngoặc vuông [ và ], bản dịch "natural" và "quick" của dòng đó BẮT BUỘC phải sử dụng đúng cặp dấu ngoặc vuông [ và ] (TUYỆT ĐỐI KHÔNG ĐƯỢC đổi thành 【 và 】 hay bất kỳ dấu nào khác).
- Nếu dòng gốc dùng cặp dấu ngoặc ô đen 【 và 】, bản dịch "natural" và "quick" của dòng đó BẮT BUỘC phải sử dụng đúng cặp dấu 【 và 】 (TUYỆT ĐỐI KHÔNG ĐƯỢC đổi thành [ và ] hay bất kỳ dấu nào khác).
- Đảm bảo giữ nguyên vẹn cấu trúc và nội dung đặt trong các dấu ngoặc tương ứng với ngữ cảnh dịch thuật của chúng.
3. TUYỆT ĐỐI KHÔNG ĐƯỢC GIỮ NGUYÊN HOẶC ĐỂ LẪN bất kỳ ký tự tiếng Trung/chữ Hán nào (như 捕食, 吞噬, v.v.) trong bản dịch "natural" và "quick". Tất cả các từ tiếng Trung xuất hiện trong văn bản gốc (hoặc trong câu hỗn hợp) đều PHẢI được dịch hoàn toàn sang tiếng Việt tự nhiên, phù hợp với ngữ cảnh tiểu thuyết (Ví dụ: "捕食" -> "săn mồi", "吞噬" -> "nuốt chửng" hoặc "thôn phệ"). Bản dịch đầu ra cuối cùng phải hoàn toàn viết bằng chữ Quốc ngữ tiếng Việt.
4. NGHIÊM CẤM TỰ Ý THAY THẾ HOẶC ĐỒNG NHẤT TÊN NHÂN VẬT:
- Bạn PHẢI dịch chính xác nguyên văn chữ Hán của tên nhân vật xuất hiện ở câu gốc.
- TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý suy diễn để thay thế hoặc đồng nhất tên biệt danh, tên tài khoản game, tên gọi khác thành tên thật (hoặc ngược lại).
- Ví dụ cụ thể: Nếu câu gốc xuất hiện tên tài khoản trong game hoặc biệt danh "周而复始" (Chu Nhi Phục Thủy), bạn PHẢI dịch chính xác là "Chu Nhi Phục Thủy", TUYỆT ĐỐI KHÔNG được tự ý đổi nó thành tên thật là "Chu Tùy" (周随) trong bản dịch, cho dù bạn biết họ là cùng một người từ danh sách nhân vật/bối cảnh. Tuân thủ chính xác 100% chữ Hán gốc của tên riêng xuất hiện trong câu.

BỐI CẢNH & TỪ ĐIỂN CỦA TÁC PHẨM (ƯU TIÊN TỐI ĐA):
${customDictionary.length > 0 ? `- Từ vựng đặc biệt: ${customDictionary.map(i => `"${i.term}" PHẢI DỊCH LÀ "${i.meaning}"`).join(', ')}` : ""}
${characters.length > 0 ? `- Nhân vật: ${characters.map(c => `"${c.chineseName}" PHẢI DỊCH LÀ "${c.vietName}" (Đại từ nhân xưng: ${c.pronouns})`).join('\n  ')}` : ""}
${relationships.length > 0 ? `- Xưng hô:\n  ${relationships.map(r => `Giữa "${r.charA}" và "${r.charB}": "${r.charA}" gọi "${r.charB}" là "${r.callAtoB}", và "${r.charB}" gọi "${r.charA}" là "${r.callBtoA}"`).join('\n  ')}` : ""}
`;

    const textWithIndex = chunkLines.map((line, idx) => `[L${idx + 1}]: ${line}`).join('\n');
    const prompt = `${contextPrompt}\n\nDịch ${chunkLineCount} dòng sau:\n${textWithIndex}`;
    
    console.log(`Đang xử lý chunk ${i + 1}/${chunks.length} (${chunkLineCount} dòng, ${chunkCharCount} ký tự)`);

    const result = await performApiCallWithFallback(prompt);
    
    if (i === 0) firstModelUsed = result.modelUsed;
    
    // Khởi tạo danh sách segment đồng bộ cho chunk này để tránh bị lệch dòng
    const chunkSegments = Array.from({ length: chunkLineCount }, (_, idx) => ({
      source: chunkLines[idx],
      natural: "",
      quick: ""
    }));

    const apiSegments = result.segments || [];
    
    // Hàm chuẩn hóa lineIndex từ mọi kiểu dữ liệu (số, chuỗi "L17", "[L17]", "17", v.v.)
    const getNormalizedLineIndex = (val: any): number | null => {
      if (typeof val === 'number') return Math.floor(val);
      if (typeof val === 'string') {
        const cleaned = val.trim();
        const match = cleaned.match(/\d+/);
        if (match) {
          return parseInt(match[0], 10);
        }
      }
      return null;
    };

    const hasLineIndices = apiSegments.some((seg: any) => {
      const idx = getNormalizedLineIndex(seg?.lineIndex);
      return idx !== null && idx >= 1 && idx <= chunkLineCount;
    });

    if (hasLineIndices) {
      for (const seg of apiSegments as any[]) {
        const rawIdx = getNormalizedLineIndex(seg?.lineIndex);
        if (rawIdx !== null) {
          const idx = rawIdx - 1;
          if (idx >= 0 && idx < chunkLineCount) {
            const naturalPart = (seg.natural || "").trim();
            const quickPart = (seg.quick || "").trim();
            
            if (naturalPart) {
              if (chunkSegments[idx].natural) {
                chunkSegments[idx].natural += " " + naturalPart;
              } else {
                chunkSegments[idx].natural = naturalPart;
              }
            }
            if (quickPart) {
              if (chunkSegments[idx].quick) {
                chunkSegments[idx].quick += " " + quickPart;
              } else {
                chunkSegments[idx].quick = quickPart;
              }
            }
          }
        }
      }
    } else {
      // Dự phòng nếu không có lineIndex: map 1-1 theo thứ tự trả về
      for (let idx = 0; idx < chunkLineCount; idx++) {
        const seg = apiSegments[idx];
        if (seg) {
          chunkSegments[idx].natural = (seg.natural || "").trim();
          chunkSegments[idx].quick = (seg.quick || "").trim();
        }
      }
    }

    allSegments = allSegments.concat(chunkSegments);
    
    for (const v of result.vocabulary || []) {
      if (!allVocabulary.some(existing => existing.term === v.term)) {
        allVocabulary.push(v);
      }
    }
    
    if (result.sinoVietnamese) {
      allSinoVietnamese += (allSinoVietnamese ? " " : "") + result.sinoVietnamese;
    }
  }

  // HẬU XỬ LÝ: Đảm bảo số lượng đoạn khớp 100% và khôi phục text gốc để tránh AI tự chế
  const synchronizedSegments = inputLines.map((originalLine, index) => {
      const aiSeg = allSegments[index];
      return {
          source: originalLine, // Luôn dùng bản gốc từ input, không dùng bản AI trả về
          natural: aiSeg?.natural || "",
          quick: aiSeg?.quick || "",
          deepl: "" // Sẽ được merge ở App.tsx
      };
  });

  return {
    segments: synchronizedSegments,
    sinoVietnamese: allSinoVietnamese,
    vocabulary: allVocabulary,
    naturalTranslation: synchronizedSegments.map(s => s.natural).join('\n'),
    quickTrans: synchronizedSegments.map(s => s.quick).join('\n'),
    deeplTranslation: "",
    modelUsed: firstModelUsed || "unknown"
  };
};

export const quickLookup = async (term: string): Promise<{ pinyin: string; hanViet: string; meaning: string }> => {
  await waitForQuota();
  const prompt = `Tra từ: "${term.trim()}". Trả về JSON: pinyin, hanViet, meaning.`;
  const schema = {
    type: Type.OBJECT,
    properties: { 
        pinyin: { type: Type.STRING }, 
        hanViet: { type: Type.STRING }, 
        meaning: { type: Type.STRING } 
    },
    required: ["pinyin", "hanViet", "meaning"]
  };
  
  // Quick lookup chỉ dùng flash để nhanh
  try {
    const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: { 
            responseMimeType: "application/json", 
            responseSchema: schema,
            temperature: 0.1
        }
    });
    const data = JSON.parse(response.text?.trim() || "{}");
    return {
        pinyin: (data.pinyin || "").trim(),
        hanViet: (data.hanViet || "").trim(),
        meaning: (data.meaning || "Lỗi").trim()
    };
  } catch (e) {
    return { pinyin: "", hanViet: "", meaning: "Lỗi" };
  }
};
