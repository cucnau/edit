with open('components/TranslationOutput.tsx', 'r') as f:
    text = f.read()

text = text.replace("<SegmentCopyBtn text={cleanNatural} />", """<button
                                  onClick={() => onToggleComplete?.(idx)}
                                  className={`absolute top-0 right-0 p-1 rounded-full transition-all shadow-sm border z-10 ${isDone ? 'opacity-100 bg-green-100 border-green-200 text-green-600 hover:bg-green-200' : 'opacity-0 group-hover/row:opacity-100 bg-white/70 hover:bg-white text-[#A1887F] hover:text-[#3E2723] border-[#D7CCC8]'}`}
                                  title={isDone ? "Đã đánh dấu hoàn thành (Click để bỏ)" : "Đánh dấu hoàn thành"}
                               >
                                  <CheckCircle2 size={isFocusMode ? 14 : 12} />
                               </button>""")

with open('components/TranslationOutput.tsx', 'w') as f:
    f.write(text)
