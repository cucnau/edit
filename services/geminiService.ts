import { TranslationResponse, CustomTerm, Character, Relationship } from '../types';

export const translateText = async (
  text: string,
  customDictionary: CustomTerm[] = [],
  characters: Character[] = [],
  relationships: Relationship[] = []
): Promise<TranslationResponse & { modelUsed: string }> => {
  if (!text.trim()) throw new Error('Vui lòng nhập văn bản.');

  const response = await fetch('/api/gemini/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      customDictionary,
      characters,
      relationships,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as
    | (TranslationResponse & { modelUsed: string })
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      ('error' in payload && payload.error) || 'Không thể kết nối máy chủ dịch thuật.'
    );
  }

  return payload as TranslationResponse & { modelUsed: string };
};

export const quickLookup = async (
  term: string
): Promise<{ pinyin: string; hanViet: string; meaning: string }> => {
  try {
    const response = await fetch('/api/gemini/quick-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term }),
    });

    if (!response.ok) {
      return { pinyin: '', hanViet: '', meaning: 'Lỗi' };
    }

    const data = (await response.json()) as {
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
    return { pinyin: '', hanViet: '', meaning: 'Lỗi' };
  }
};

export const alignTextWithAI = async (
  rawLines: string[],
  pastedText: string,
  forceFastAlign = false
): Promise<string[]> => {
  if (!pastedText.trim()) return new Array(rawLines.length).fill('');

  // TỐI ƯU QUOTA: Kiểm tra nếu số dòng dịch dán vào khớp chính xác với số dòng gốc có text
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
    console.log('Khớp số dòng 1-1, bỏ qua gọi AI để tiết kiệm API.');
    return result;
  }

  try {
    const response = await fetch('/api/gemini/align', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawLines,
        pastedText,
        forceFastAlign,
      }),
    });

    if (!response.ok) {
      return new Array(rawLines.length).fill('');
    }

    const data = (await response.json()) as { lines?: string[] };
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (lines.length > rawLines.length) return lines.slice(0, rawLines.length);
    if (lines.length < rawLines.length) {
      return [...lines, ...new Array(rawLines.length - lines.length).fill('')];
    }
    return lines;
  } catch (err) {
    console.error('AI Alignment request failed, falling back to empty strings', err);
    return new Array(rawLines.length).fill('');
  }
};
