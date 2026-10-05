import re
with open('services/geminiService.ts', 'r') as f:
    text = f.read()

# Match the export function using a robust regex and replace all occurrences except the first one
pattern = r"export const alignTextWithAI = async.*?};"
matches = list(re.finditer(pattern, text, re.DOTALL))

if len(matches) > 1:
    # Keep only the first occurrence, remove the rest
    for match in reversed(matches[1:]):
        text = text[:match.start()] + text[match.end():]

with open('services/geminiService.ts', 'w') as f:
    f.write(text)
