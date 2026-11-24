import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from '@google/genai';

try {
  (process as unknown as { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  // Bỏ qua nếu không có file .env cục bộ
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface CustomTerm {
  id: string;
  novelId?: string;
  term: string;
  meaning: string;
  category?: string;
}

interface Character {
  id: string;
  novelId?: string;
  chineseName: string;
  vietName: string;
  pronouns: string;
  description: string;
}

interface Relationship {
  id: string;
  novelId?: string;
  charA: string;
  charB: string;
  callAtoB: string;
  callBtoA: string;
}

interface VocabItem {
  term: string;
  pinyin: string;
  hanViet: string;
  meaning: string;
  explanation: string;
}

interface TranslationSegment {
  source: string;
  natural: string;
  quick: string;
  deepl?: string;
}

interface TranslationResponse {
  segments: TranslationSegment[];
  sinoVietnamese: string;
  vocabulary: VocabItem[];
  naturalTranslation: string;
  quickTrans: string;
  deeplTranslation?: string;
  modelUsed?: string;
}

let aiClient: GoogleGenAI | null = null;
let cachedApiKey = '';

const getAiClient = (): GoogleGenAI => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Máy chủ chưa được cấu hình GEMINI_API_KEY.');
  }
  if (aiClient && cachedApiKey === apiKey) {
    return aiClient;
  }
  cachedApiKey = apiKey;
  aiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return aiClient;
};

// Danh sách các model ưu tiên thử nghiệm theo thứ tự khi gặp lỗi
const FALLBACK_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-pro-latest',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];

const MIN_REQUEST_INTERVAL = 200;

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const translationSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      description: 'Danh sách các đoạn văn ứng với từng dòng của văn bản gốc.',
      items: {
        type: Type.OBJECT,
        properties: {
          lineIndex: {
            type: Type.INTEGER,
            description: 'Số thứ tự dòng tương ứng (1-indexed). Ví dụ dòng [L1] thì lineIndex là 1, dòng [L2] là 2.',
          },
          natural: { type: Type.STRING, description: 'Bản dịch mượt.' },
        },
        required: ['lineIndex', 'natural'],
      },
    },
    vocabulary: {
      type: Type.ARRAY,
      description: 'Danh sách từ vựng quan trọng.',
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          pinyin: { type: Type.STRING },
          hanViet: { type: Type.STRING },
          meaning: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ['term', 'pinyin', 'hanViet', 'meaning', 'explanation'],
      },
    },
  },
  required: ['segments', 'vocabulary'],
};

let lastRequestTime = 0;
let quotaChain: Promise<void> = Promise.resolve();
const waitForQuota = (): Promise<void> => {
  const next = quotaChain.then(async () => {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_INTERVAL) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLast));
    }
    lastRequestTime = Date.now();
  });
  quotaChain = next.catch(() => {});
  return next;
};

const cleanJsonString = (str: string) => {
  return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
};

const performApiCallWithFallback = async (
  prompt: string
): Promise<TranslationResponse & { modelUsed: string }> => {
  let lastError: unknown = null;
  const maxRetriesPerModel = 3;
  const modelsToTry = [...FALLBACK_MODELS];

  for (const modelId of modelsToTry) {
    let retries = 0;

    while (retries <= maxRetriesPerModel) {
      try {
        await waitForQuota();
        const apiConfig: Record<string, unknown> = {
          responseMimeType: 'application/json',
          responseSchema: translationSchema,
          safetySettings: SAFETY_SETTINGS,
        };
        if (!modelId.startsWith('gemini-4-')) {
          apiConfig.temperature = 0.1;
        }
        const response = await getAiClient().models.generateContent({
          model: modelId,
          contents: prompt,
          config: apiConfig,
        });

        const text = response.text;
        if (!text) throw new Error('AI không phản hồi');

        const cleaned = cleanJsonString(text);
        const parsed = JSON.parse(cleaned) as TranslationResponse;
        return { ...parsed, modelUsed: modelId };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e || '');
        console.warn(`Model ${modelId} thất bại (Lần ${retries + 1}):`, message);
        lastError = e;

        const isOverloaded =
          message.includes('503') ||
          message.includes('429') ||
          message.includes('high demand') ||
          message.includes('UNAVAILABLE') ||
          message.includes('quota') ||
          message.includes('RESOURCE_EXHAUSTED');

        if (isOverloaded && retries < maxRetriesPerModel) {
          const retryMatch =
            message.match(/retry in\s+([\d.]+)\s*s/i) ||
            message.match(/Please retry in\s+([\d.]+)\s*s/i);
          let waitTime = Math.pow(2, retries) * 3000;
          if (retryMatch) {
            const parsedSeconds = parseFloat(retryMatch[1]);
            if (!isNaN(parsedSeconds)) {
              waitTime = parsedSeconds * 1000 + 1500;
            }
          }

          console.log(`Đang bị giới hạn quota/tải. Đợi ${Math.ceil(waitTime / 1000)} giây trước khi thử lại...`);
          await new Promise((r) => setTimeout(r, waitTime));
          retries++;
        } else {
          await new Promise((r) => setTimeout(r, 1000));
          break;
        }
      }
    }
  }

  const lastMessage = lastError instanceof Error ? lastError.message : '';
  if (lastMessage.includes('Unterminated string') || lastMessage.includes('Unexpected end')) {
    throw new Error('Văn bản quá dài khiến AI bị quá tải dữ liệu. Hãy chia nhỏ văn bản (tầm 15-20 dòng) để AI dịch đầy đủ nhất.');
  }
  if (lastMessage.includes('503') || lastMessage.includes('high demand')) {
    throw new Error('Hệ thống AI đang quá tải do có nhiều người cùng sử dụng lúc này. Bạn thử ấn dịch lại lần nữa nhé!');
  }

  throw new Error(lastMessage || 'Tất cả các model AI đều không thể phản hồi lúc này.');
};

const translateTextServer = async (
  text: string,
  customDictionary: CustomTerm[] = [],
  characters: Character[] = [],
  relationships: Relationship[] = []
): Promise<TranslationResponse & { modelUsed: string }> => {
  if (!text.trim()) throw new Error('Vui lòng nhập văn bản.');

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

  const getNormalizedLineIndex = (val: unknown): number | null => {
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

  const MAX_CONCURRENT_CHUNKS = 3;
  const chunkResults: Array<{
    segments: { source: string; natural: string; quick: string }[];
    vocabulary: VocabItem[];
    modelUsed: string;
  }> = new Array(chunks.length);

  let nextChunkIdx = 0;
  const processChunk = async (i: number) => {
    const chunkLines = chunks[i];
    const chunkLineCount = chunkLines.length;
    const chunkCharCount = chunkLines.reduce((acc, line) => acc + line.length, 0);

    const vocabTarget = Math.max(5, Math.min(40, Math.floor(chunkCharCount / 40)));

    const contextPrompt = `Bạn là chuyên gia dịch thuật Trung-Việt cho tiểu thuyết.
YÊU CẦU NGHIÊM NGẶT VỀ CẤU TRÚC:
1. Văn bản này có đúng CHÍNH XÁC ${chunkLineCount} dòng, được đánh dấu từ [L1] đến [L${chunkLineCount}]. Bạn PHẢI dịch từng dòng độc lập và trả về mảng "segments" chứa bản dịch tương ứng.
2. Với mỗi segment, bạn PHẢI gán đúng "lineIndex" tương ứng với số thứ tự của dòng gốc trong khối văn bản này (từ 1 đến ${chunkLineCount}). Ví dụ: dòng [L1] có lineIndex là 1, dòng [L2] là 2.
3. Mỗi dòng gốc (từ [L1] đến [L${chunkLineCount}]) PHẢI tương ứng với ĐÚNG 1 phần tử (segment) duy nhất trong mảng "segments", có "lineIndex" tương ứng. TUYỆT ĐỐI KHÔNG ĐƯỢC phép tách một dòng gốc thành nhiều segment nhỏ hơn trong mảng, và TUYỆT ĐỐI KHÔNG ĐƯỢC gộp nhiều dòng gốc vào chung một segment. Bản dịch của toàn bộ dòng gốc đó phải nằm trọn vẹn trong thuộc tính "natural" của segment đó.
4. Nếu dòng gốc trống, segment tương ứng vẫn phải tồn tại trong "segments" với "natural" rỗng.
5. Dựa trên độ dài văn bản (${chunkCharCount} ký tự), trích xuất khoảng ${vocabTarget} từ vựng vào mảng "vocabulary". 
   ƯU TIÊN TRÍCH XUẤT TRIỆT ĐỂ: Bạn PHẢI quét toàn bộ văn bản và đưa TẤT CẢ các tên riêng (nhân vật chưa có trong danh sách, địa danh, môn phái, chiêu thức, vật phẩm đặc thù) vào vocabulary để người dùng tra cứu. Không được bỏ sót bất kỳ thực thể danh từ riêng nào.

YÊU CẦU BẮT BUỘC VỀ DỊCH THUẬT (PHẢI TUÂN THỦ 100%):
1. Bạn PHẢI sử dụng ĐÚNG các từ vựng, tên nhân vật, đại từ nhân xưng và quy tắc xưng hô được cung cấp dưới đây trong bản dịch "natural". Nếu vi phạm, bản dịch sẽ bị coi là lỗi nghiêm trọng.
2. NGUYÊN TẮC DẤU NGOẶC:
- Nếu dòng gốc dùng cặp dấu ngoặc vuông [ và ], bản dịch "natural" của dòng đó BẮT BUỘC phải sử dụng đúng cặp dấu ngoặc vuông [ và ] (TUYỆT ĐỐI KHÔNG ĐƯỢC đổi thành 【 và 】 hay bất kỳ dấu nào khác).
- Nếu dòng gốc dùng cặp dấu ngoặc ô đen 【 và 】, bản dịch "natural" của dòng đó BẮT BUỘC phải sử dụng đúng cặp dấu 【 và 】 (TUYỆT ĐỐI KHÔNG ĐƯỢC đổi thành [ và ] hay bất kỳ dấu nào khác).
- Đảm bảo giữ nguyên vẹn cấu trúc và nội dung đặt trong các dấu ngoặc tương ứng với ngữ cảnh dịch thuật của chúng.
3. TUYỆT ĐỐI KHÔNG ĐƯỢC GIỮ NGUYÊN HOẶC ĐỂ LẪN bất kỳ ký tự tiếng Trung/chữ Hán nào (như 捕食, 吞噬, v.v.) trong bản dịch "natural". Tất cả các từ tiếng Trung xuất hiện trong văn bản gốc (hoặc trong câu hỗn hợp) đều PHẢI được dịch hoàn toàn sang tiếng Việt tự nhiên, phù hợp với ngữ cảnh tiểu thuyết (Ví dụ: "捕食" -> "săn mồi", "吞噬" -> "nuốt chửng" hoặc "thôn phệ"). Bản dịch đầu ra cuối cùng phải hoàn toàn viết bằng chữ Quốc ngữ tiếng Việt.
4. NGHIÊM CẤM TỰ Ý THAY THẾ HOẶC ĐỒNG NHẤT TÊN NHÂN VẬT:
- Bạn PHẢI dịch chính xác nguyên văn chữ Hán của tên nhân vật xuất hiện ở câu gốc.
- TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý suy diễn để thay thế hoặc đồng nhất tên biệt danh, tên tài khoản game, tên gọi khác thành tên thật (hoặc ngược lại).
- Ví dụ cụ thể: Nếu câu gốc xuất hiện tên tài khoản trong game hoặc biệt danh "周而复始" (Chu Nhi Phục Thủy), bạn PHẢI dịch chính xác là "Chu Nhi Phục Thủy", TUYỆT ĐỐI KHÔNG được tự ý đổi nó thành tên thật là "Chu Tùy" (周随) trong bản dịch, cho dù bạn biết họ là cùng một người từ danh sách nhân vật/bối cảnh. Tuân thủ chính xác 100% chữ Hán gốc của tên riêng xuất hiện trong câu.
5. PHÂN BIỆT RÕ RÀNG VÀ BẮT BUỘC ƯU TIÊN KHO TỪ VỰNG SO VỚI TÊN NHÂN VẬT:
- Danh sách "Từ vựng đặc biệt" (kho từ vựng) chứa các từ ngữ, chiêu thức, vật phẩm, danh từ riêng... BẮT BUỘC phải dịch đúng 100% sang nghĩa tiếng Việt đã quy định khi chữ Hán đó xuất hiện.
- Danh sách "Nhân vật" CHỈ dùng khi đúng tên nhân vật xuất hiện. TUYỆT ĐỐI KHÔNG ĐƯỢC nhầm lẫn hoặc lấy tên nhân vật để dịch đè lên các từ vựng/chiêu thức/vật phẩm có chứa từ ngữ gần giống hoặc nằm trong "Từ vựng đặc biệt".
- Trường hợp chữ Hán trùng hoặc có thành tố giống nhau, PHẢI ƯU TIÊN ÁP DỤNG NGHĨA TRONG "TỪ VỰNG ĐẶC BIỆT".

BỐI CẢNH & TỪ ĐIỂN CỦA TÁC PHẨM (ƯU TIÊN TỐI ĐA):
${customDictionary.length > 0 ? `- Từ vựng đặc biệt: ${customDictionary.map((item) => `"${item.term}" PHẢI DỊCH LÀ "${item.meaning}"`).join(', ')}` : ''}
${characters.length > 0 ? `- Nhân vật: ${characters.map((c) => `"${c.chineseName}" PHẢI DỊCH LÀ "${c.vietName}" (Đại từ nhân xưng: ${c.pronouns})`).join('\n  ')}` : ''}
${relationships.length > 0 ? `- Xưng hô:\n  ${relationships.map((r) => `Giữa "${r.charA}" và "${r.charB}": "${r.charA}" gọi "${r.charB}" là "${r.callAtoB}", và "${r.charB}" gọi "${r.charA}" là "${r.callBtoA}"`).join('\n  ')}` : ''}
`;

    const textWithIndex = chunkLines.map((line, idx) => `[L${idx + 1}]: ${line}`).join('\n');
    const prompt = `${contextPrompt}\n\nDịch ${chunkLineCount} dòng sau:\n${textWithIndex}`;

    console.log(`Đang xử lý chunk ${i + 1}/${chunks.length} (${chunkLineCount} dòng, ${chunkCharCount} ký tự)`);

    const result = await performApiCallWithFallback(prompt);

    const chunkSegments = Array.from({ length: chunkLineCount }, (_, idx) => ({
      source: chunkLines[idx],
      natural: '',
      quick: '',
    }));

    const apiSegments = (result.segments || []) as Array<{ lineIndex?: unknown; natural?: string }>;

    const hasLineIndices = apiSegments.some((seg) => {
      const idx = getNormalizedLineIndex(seg?.lineIndex);
      return idx !== null && idx >= 1 && idx <= chunkLineCount;
    });

    if (hasLineIndices) {
      for (const seg of apiSegments) {
        const rawIdx = getNormalizedLineIndex(seg?.lineIndex);
        if (rawIdx !== null) {
          const idx = rawIdx - 1;
          if (idx >= 0 && idx < chunkLineCount) {
            const naturalPart = (seg.natural || '').trim();
            if (naturalPart) {
              chunkSegments[idx].natural = chunkSegments[idx].natural
                ? `${chunkSegments[idx].natural} ${naturalPart}`
                : naturalPart;
            }
          }
        }
      }
    } else {
      for (let idx = 0; idx < chunkLineCount; idx++) {
        const seg = apiSegments[idx];
        if (seg) {
          chunkSegments[idx].natural = (seg.natural || '').trim();
        }
      }
    }

    chunkResults[i] = {
      segments: chunkSegments,
      vocabulary: result.vocabulary || [],
      modelUsed: result.modelUsed,
    };
  };

  const workerCount = Math.min(MAX_CONCURRENT_CHUNKS, chunks.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextChunkIdx < chunks.length) {
        const currentIdx = nextChunkIdx++;
        await processChunk(currentIdx);
      }
    })
  );

  let allSegments: Array<{ source: string; natural: string; quick: string }> = [];
  const allVocabulary: VocabItem[] = [];
  let firstModelUsed = '';

  for (let i = 0; i < chunkResults.length; i++) {
    const chunkRes = chunkResults[i];
    if (!chunkRes) continue;
    if (!firstModelUsed && chunkRes.modelUsed) firstModelUsed = chunkRes.modelUsed;
    allSegments = allSegments.concat(chunkRes.segments);
    for (const v of chunkRes.vocabulary) {
      if (!allVocabulary.some((existing) => existing.term === v.term)) {
        allVocabulary.push(v);
      }
    }
  }

  const synchronizedSegments = inputLines.map((originalLine, index) => {
    const aiSeg = allSegments[index];
    return {
      source: originalLine,
      natural: aiSeg?.natural || '',
      quick: '',
      deepl: '',
    };
  });

  return {
    segments: synchronizedSegments,
    sinoVietnamese: '',
    vocabulary: allVocabulary,
    naturalTranslation: synchronizedSegments.map((s) => s.natural).join('\n'),
    quickTrans: '',
    deeplTranslation: '',
    modelUsed: firstModelUsed || 'unknown',
  };
};

const quickLookupServer = async (
  term: string
): Promise<{ pinyin: string; hanViet: string; meaning: string }> => {
  await waitForQuota();
  const prompt = `Tra từ: "${term.trim()}". Trả về JSON: pinyin, hanViet, meaning.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      pinyin: { type: Type.STRING },
      hanViet: { type: Type.STRING },
      meaning: { type: Type.STRING },
    },
    required: ['pinyin', 'hanViet', 'meaning'],
  };

  const lookupModels = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.7-flash'];
  for (const modelId of lookupModels) {
    try {
      const apiConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
        responseSchema: schema,
      };
      if (!modelId.startsWith('gemini-4-')) {
        apiConfig.temperature = 0.1;
      }
      const response = await getAiClient().models.generateContent({
        model: modelId,
        contents: prompt,
        config: apiConfig,
      });
      const data = JSON.parse(response.text?.trim() || '{}') as {
        pinyin?: string;
        hanViet?: string;
        meaning?: string;
      };
      return {
        pinyin: (data.pinyin || '').trim(),
        hanViet: (data.hanViet || '').trim(),
        meaning: (data.meaning || 'Lỗi').trim(),
      };
    } catch {
      // Thử model tiếp theo
    }
  }
  return { pinyin: '', hanViet: '', meaning: 'Lỗi' };
};

const alignTextWithAIServer = async (
  rawLines: string[],
  pastedText: string,
  forceFastAlign = false
): Promise<string[]> => {
  if (!pastedText.trim()) return new Array(rawLines.length).fill('');

  const tLines = pastedText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l);
  const rLinesWithIndices = rawLines.map((l, i) => ({ text: l.trim(), index: i }));
  const validRLines = rLinesWithIndices.filter((l) => l.text);

  if (tLines.length > 0 && validRLines.length > 0 && (tLines.length === validRLines.length || forceFastAlign)) {
    const result = new Array(rawLines.length).fill('');
    let tIdx = 0;
    validRLines.forEach((rLine) => {
      if (tIdx < tLines.length) {
        result[rLine.index] = tLines[tIdx++];
      }
    });
    return result;
  }

  const rawText = rawLines.map((l, i) => `[L${i + 1}] ${l}`).join('\n');
  const prompt = `Bạn là một chuyên gia đối chiếu văn bản. Nhiệm vụ của bạn là gióng hàng (align) bản dịch được cung cấp sao cho khớp chính xác với từng dòng của bản gốc (raw text). Bản dịch có thể bị dính dòng, gộp dòng hoặc thừa thiếu xuống dòng so với bản gốc.

RAW TEXT (Bản gốc, đã được đánh số dòng):
${rawText}

TRANSLATION (Bản dịch cần gióng hàng):
${pastedText}

Hãy trả về một danh sách các chuỗi, trong đó mỗi chuỗi tương ứng với nội dung bản dịch của một dòng gốc. Nếu một dòng gốc không có nội dung dịch tương ứng hoặc là dòng trống, hãy để chuỗi rỗng "". Bắt buộc phải trả về mảng có độ dài CHÍNH XÁC bằng ${rawLines.length}. Đừng bỏ sót bất kỳ dòng nào.`;

  const schema = {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description: `Mảng chứa ${rawLines.length} chuỗi, mỗi chuỗi là bản dịch tương ứng của dòng gốc.`,
  };

  let lastError: unknown = null;
  const maxRetriesPerModel = 2;
  const modelsToTry = [...FALLBACK_MODELS];

  for (const modelId of modelsToTry) {
    let retries = 0;
    while (retries <= maxRetriesPerModel) {
      try {
        await waitForQuota();
        const apiConfig: Record<string, unknown> = {
          responseMimeType: 'application/json',
          responseSchema: schema,
        };
        if (!modelId.startsWith('gemini-4-')) {
          apiConfig.temperature = 0.1;
        }
        const response = await getAiClient().models.generateContent({
          model: modelId,
          contents: prompt,
          config: apiConfig,
        });

        let result: string[] = JSON.parse(response.text?.trim() || '[]');
        if (result.length > rawLines.length) {
          result = result.slice(0, rawLines.length);
        } else if (result.length < rawLines.length) {
          result = [...result, ...new Array(rawLines.length - result.length).fill('')];
        }

        console.log(`Aligned text successfully using model: ${modelId}`);
        return result;
      } catch (err: unknown) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err || '');
        if (message.includes('429') || message.includes('Resource has been exhausted')) {
          console.warn(
            `[alignTextWithAI] Quota exceeded on ${modelId} (Lần ${retries + 1}/${maxRetriesPerModel + 1}). Thử lại sau 2s...`
          );
          await new Promise((r) => setTimeout(r, 2000));
          retries++;
          continue;
        }
        console.warn(`[alignTextWithAI] Lỗi model ${modelId}: ${message}. Chuyển model...`);
        break;
      }
    }
  }

  console.error('AI Alignment failed on all models, falling back to empty strings', lastError);
  return new Array(rawLines.length).fill('');
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.post('/api/gemini/translate', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        text?: unknown;
        customDictionary?: unknown;
        characters?: unknown;
        relationships?: unknown;
      };

      if (typeof body.text !== 'string' || !body.text.trim()) {
        res.status(400).json({ error: 'Vui lòng nhập văn bản.' });
        return;
      }

      const customDictionary = Array.isArray(body.customDictionary) ? (body.customDictionary as CustomTerm[]) : [];
      const characters = Array.isArray(body.characters) ? (body.characters as Character[]) : [];
      const relationships = Array.isArray(body.relationships) ? (body.relationships as Relationship[]) : [];

      const result = await translateTextServer(body.text, customDictionary, characters, relationships);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Đã xảy ra lỗi khi gọi AI.';
      console.error('[/api/gemini/translate] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/gemini/quick-lookup', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { term?: unknown };
      if (typeof body.term !== 'string' || !body.term.trim()) {
        res.status(400).json({ error: 'Thiếu từ cần tra cứu.' });
        return;
      }

      const result = await quickLookupServer(body.term.slice(0, 150));
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Lỗi tra cứu AI.';
      console.error('[/api/gemini/quick-lookup] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/gemini/align', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        rawLines?: unknown;
        pastedText?: unknown;
        forceFastAlign?: unknown;
      };

      if (!Array.isArray(body.rawLines) || typeof body.pastedText !== 'string') {
        res.status(400).json({ error: 'Dữ liệu gióng hàng không hợp lệ.' });
        return;
      }

      const rawLines = body.rawLines.map((line) => (typeof line === 'string' ? line : String(line ?? '')));
      const aligned = await alignTextWithAIServer(rawLines, body.pastedText, Boolean(body.forceFastAlign));
      res.json({ lines: aligned });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Lỗi gióng hàng AI.';
      console.error('[/api/gemini/align] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
