import re

with open("App.tsx", "r") as f:
    text = f.read()

old_block = """    try {
      // --- BƯỚC 2: GỌI AI ---
      const data = await translateText(
        session.inputText, 
        session.customTerms,
        session.characters,
        session.relationships
      );
      
      // --- BƯỚC 3: MERGE KẾT QUẢ ---
      let mergedSegments = [];
      const hasPreEdited = !!(session.preEditedText && session.preEditedText.trim());

      if (mode === 'beta' && hasPreEdited) {
         // Align pre-edited text to source lines
         const preEditedLines = alignTranslation(inputLines, session.preEditedText || "");
         
         // Align GG/DeepL text to source lines if it was provided
         const hasDeepl = !!(session.deeplText && session.deeplText.trim());
         const deeplLines = hasDeepl ? alignTranslation(inputLines, session.deeplText) : [];

         mergedSegments = inputLines.map((line, i) => {
             // In Beta mode:
             // - If GG/DeepL is NOT pasted, we use the AI natural translation as "deepl" reference
             // - If GG/DeepL IS pasted, we use the aligned GG/DeepL as "deepl" reference
             let refDeepl = "";
             if (hasDeepl) {
                 refDeepl = deeplLines[i] || "";
             } else {
                 refDeepl = (data.segments && data.segments[i]) ? data.segments[i].natural : "";
             }

             return {
                 source: line,
                 natural: preEditedLines[i] || "", // Main translation is replaced with aligned pre-edited text
                 quick: vpSegments[i]?.quick || ((data.segments && data.segments[i]) ? data.segments[i].quick : ""),
                 deepl: refDeepl
             };
         });
      }"""

new_block = """    try {
      const hasPreEdited = !!(session.preEditedText && session.preEditedText.trim());
      const hasDeepl = !!(session.deeplText && session.deeplText.trim());
      let data: any = null;

      if (mode === 'beta' && hasPreEdited) {
          data = {
              modelUsed: 'None (Local Alignment)',
              segments: []
          };
      } else {
          // --- BƯỚC 2: GỌI AI ---
          data = await translateText(
            session.inputText, 
            session.customTerms,
            session.characters,
            session.relationships
          );
      }
      
      // --- BƯỚC 3: MERGE KẾT QUẢ ---
      let mergedSegments = [];

      if (mode === 'beta' && hasPreEdited) {
         // Align pre-edited text to source lines
         const preEditedLines = alignTranslation(inputLines, session.preEditedText || "");
         
         // Align GG/DeepL text to source lines if it was provided
         const deeplLines = hasDeepl ? alignTranslation(inputLines, session.deeplText) : [];

         mergedSegments = inputLines.map((line, i) => {
             // In Beta mode:
             // - If GG/DeepL is NOT pasted, we just leave it empty since we skip AI
             // - If GG/DeepL IS pasted, we use the aligned GG/DeepL as "deepl" reference
             let refDeepl = "";
             if (hasDeepl) {
                 refDeepl = deeplLines[i] || "";
             }

             return {
                 source: line,
                 natural: preEditedLines[i] || "", // Main translation is replaced with aligned pre-edited text
                 quick: vpSegments[i]?.quick || "",
                 deepl: refDeepl
             };
         });
      }"""

text = text.replace(old_block, new_block)

with open("App.tsx", "w") as f:
    f.write(text)
