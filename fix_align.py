with open('services/geminiService.ts', 'r') as f:
    text = f.read()

old_block = """  try {
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
  }"""

new_block = """  let lastError: any = null;
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
        
        console.log(`Aligned text successfully using model: ${modelId}`);
        return result;
      } catch (err: any) {
        lastError = err;
        const message = err?.message || "";
        // Nếu lỗi 429 quá tải, thử lại sau 2s
        if (message.includes("429") || message.includes("Resource has been exhausted")) {
          console.warn(`[alignTextWithAI] Quota exceeded on ${modelId} (Lần ${retries + 1}/${maxRetriesPerModel + 1}). Thử lại sau 2s...`);
          await new Promise(r => setTimeout(r, 2000));
          retries++;
          continue;
        }
        // Các lỗi khác thì chuyển model
        console.warn(`[alignTextWithAI] Lỗi model ${modelId}: ${message}. Chuyển model...`);
        break;
      }
    }
  }

  console.error("AI Alignment failed on all models, falling back to empty strings", lastError);
  return new Array(rawLines.length).fill("");"""

text = text.replace(old_block, new_block)

with open('services/geminiService.ts', 'w') as f:
    f.write(text)
