import re

with open('services/geminiService.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace the signature and the optimization block
old_sig = r"export const alignTextWithAI = async \(rawLines: string\[\], pastedText: string\): Promise<string\[\]> => \{"
new_sig = r"export const alignTextWithAI = async (rawLines: string[], pastedText: string, forceFastAlign = false): Promise<string[]> => {"
text = re.sub(old_sig, new_sig, text)

# Modify the optimization condition to also trigger if forceFastAlign is true
old_cond = r"if \(tLines\.length > 0 && validRLines\.length > 0 && tLines\.length === validRLines\.length\) \{"
new_cond = r"if (tLines.length > 0 && validRLines.length > 0 && (tLines.length === validRLines.length || forceFastAlign)) {"
text = re.sub(old_cond, new_cond, text)

with open('services/geminiService.ts', 'w', encoding='utf-8') as f:
    f.write(text)

with open('App.tsx', 'r', encoding='utf-8') as f:
    app_text = f.read()

# Add handleTranslateFast
old_handle = r"const handleTranslate = async \(\) => \{"
new_handle = r"const handleTranslate = async (forceFastAlign = false) => {"
app_text = re.sub(old_handle, new_handle, app_text)

# Update calls to alignTextWithAI
old_pre = r"const preEditedLines = await alignTextWithAI\(inputLines, session\.preEditedText || \"\"\);"
new_pre = r"const preEditedLines = await alignTextWithAI(inputLines, session.preEditedText || \"\", forceFastAlign);"
app_text = app_text.replace(old_pre, new_pre)

old_deepl = r"const deeplLines = await alignTextWithAI\(inputLines, session\.deeplText \|\| \"\"\);"
new_deepl = r"const deeplLines = await alignTextWithAI(inputLines, session.deeplText || \"\", forceFastAlign);"
app_text = app_text.replace(old_deepl, new_deepl)

old_deepl2 = r"const deeplLines = hasDeepl \? await alignTextWithAI\(inputLines, session\.deeplText\) : \[\];"
new_deepl2 = r"const deeplLines = hasDeepl ? await alignTextWithAI(inputLines, session.deeplText, forceFastAlign) : [];"
app_text = app_text.replace(old_deepl2, new_deepl2)

# Add the new button next to "Phân tích"
old_btn = r"""<button
                              onClick=\{handleTranslate\}
                              disabled=\{session\.status === AppStatus\.LOADING \|\| !session\.inputText\.trim\(\)\}
                              className="bg-\[\#3E2723\] text-\[\#FFECB3\] hover:bg-\[\#4E342E\] disabled:bg-\[\#A1887F\] disabled:cursor-not-allowed px-4 py-1\.5 rounded text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
                          >
                              \{session\.status === AppStatus\.LOADING \? \(<><Loader2 className="animate-spin" size=\{14\} /> Phân tích\.\.\.</>\) : \(<><Sparkles size=\{14\} /> Phân tích</>\)\}
                          </button>"""

new_btns = r"""<button
                              onClick={() => handleTranslate(true)}
                              disabled={session.status === AppStatus.LOADING || !session.inputText.trim()}
                              className="bg-[#FFFDF7] text-[#5D4037] border border-[#5D4037] hover:bg-[#EFEBE9] disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 disabled:cursor-not-allowed px-3 py-1.5 rounded text-sm font-bold flex items-center gap-1.5 transition-all shadow-sm"
                              title="Khớp 1-1 các dòng văn bản theo thứ tự (Không dùng AI, tốc độ tức thì)"
                          >
                              {session.status === AppStatus.LOADING ? <Loader2 className="animate-spin" size={14} /> : <BookOpen size={14} />}
                              Khớp 1-1
                          </button>
                          <button
                              onClick={() => handleTranslate(false)}
                              disabled={session.status === AppStatus.LOADING || !session.inputText.trim()}
                              className="bg-[#3E2723] text-[#FFECB3] hover:bg-[#4E342E] disabled:bg-[#A1887F] disabled:cursor-not-allowed px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
                          >
                              {session.status === AppStatus.LOADING ? (<><Loader2 className="animate-spin" size={14} /> Phân tích...</>) : (<><Sparkles size={14} /> Phân tích bằng AI</>)}
                          </button>"""

app_text = re.sub(old_btn, new_btns, app_text)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(app_text)
