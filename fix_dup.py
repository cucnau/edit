with open('services/geminiService.ts', 'r') as f:
    text = f.read()

text = text.replace("""export const alignTextWithAI = async (rawLines: string[], pastedText: string): Promise<string[]> => {
  if (!pastedText.trim()) return new Array(rawLines.length).fill("");
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
    description: `Mảng chứa ${rawLines.length} chuỗi, mỗi chuỗi là bản dịch tương ứng của dòng gốc.`
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-pro',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1
      }
    });
    
    let result: string[] = JSON.parse(response.text?.trim() || "[]");
    
    // Đảm bảo số lượng phần tử khớp 100% với rawLines
    if (result.length > rawLines.length) {
      result = result.slice(0, rawLines.length);
    } else if (result.length < rawLines.length) {
      result = [...result, ...new Array(rawLines.length - result.length).fill("")];
    }
    
    return result;
  } catch (err) {
    console.error("AI Alignment failed, falling back to empty strings", err);
    return new Array(rawLines.length).fill("");
  }
};
""", "", 1) # only replace one occurrence!

with open('services/geminiService.ts', 'w') as f:
    f.write(text)
