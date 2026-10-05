import re

with open("App.tsx", "r") as f:
    text = f.read()

# Add import
import_stmt = "import { alignTextWithAI } from './services/aiAlignmentService';\n"
text = re.sub(r"(import .* from './services/geminiService';\n)", r"\1" + import_stmt, text)

# Replace the calls in Beta mode
old_beta = """      if (mode === 'beta' && hasPreEdited) {
         // Align pre-edited text to source lines
         const preEditedLines = alignTranslation(inputLines, session.preEditedText || "");
         
         // Align GG/DeepL text to source lines if it was provided
         const deeplLines = hasDeepl ? alignTranslation(inputLines, session.deeplText) : [];"""

new_beta = """      if (mode === 'beta' && hasPreEdited) {
         // Align pre-edited text to source lines
         const preEditedLines = await alignTextWithAI(inputLines, session.preEditedText || "");
         
         // Align GG/DeepL text to source lines if it was provided
         const deeplLines = hasDeepl ? await alignTextWithAI(inputLines, session.deeplText) : [];"""
text = text.replace(old_beta, new_beta)

# Replace the call in Edit mode
old_edit = """      } else {
         // Standard Edit Mode
         const deeplLines = alignTranslation(inputLines, session.deeplText);"""

new_edit = """      } else {
         // Standard Edit Mode
         const deeplLines = await alignTextWithAI(inputLines, session.deeplText || "");"""
text = text.replace(old_edit, new_edit)

with open("App.tsx", "w") as f:
    f.write(text)
