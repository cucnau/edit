import re

with open('components/TranslationOutput.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Remove SegmentCopyBtn component
segment_copy_btn_pattern = re.compile(r"const SegmentCopyBtn = \(\{ text \}: \{ text: string \}\) => \{.*?^\};", re.MULTILINE | re.DOTALL)
text = segment_copy_btn_pattern.sub('', text)

# 2. Update the left side number
left_side_pattern = re.compile(
    r"<button\s+onClick=\{\(\) => onToggleComplete\?\.\(idx\)\}\s+className=\{`inline-flex items-center justify-center mr-1 transition-all select-none align-middle transform -translate-y-\[1px\] rounded \$\{isFocusMode \? 'min-w-\[20px\] h-\[20px\]' : 'min-w-\[16px\] h-\[16px\]'\} \$\{isDone \? 'text-\[\#5D4037\] scale-110' : 'text-\[\#A1887F\]/30 hover:text-\[\#3E2723\] hover:scale-110'\}`\}\s*>\s*\{isDone \? <CheckCircle2 size=\{isFocusMode \? 15 : 12\} /> : <span className=\{\`\$\{isFocusMode \? 'text-\[11px\]' : 'text-\[9px\]'\} font-bold\`\}>\{idx \+ 1\}\.</span>\}\s*</button>"
)

new_left_side = r"""<span className={`inline-flex items-center justify-center mr-1 select-none align-middle transform -translate-y-[1px] ${isFocusMode ? 'text-[11px] min-w-[20px]' : 'text-[9px] min-w-[16px]'} font-bold ${isDone ? 'text-green-600/50' : 'text-[#A1887F]/40'}`}>
                                       {idx + 1}.
                                   </span>"""

text = left_side_pattern.sub(new_left_side, text)

# 3. Replace <SegmentCopyBtn text={cleanNatural} /> with the complete toggle button
right_side_pattern = r"<SegmentCopyBtn text=\{cleanNatural\} />"
new_right_side = r"""<button
                                  onClick={() => onToggleComplete?.(idx)}
                                  className={`absolute top-0 right-0 p-1 rounded-full transition-all shadow-sm border z-10 ${isDone ? 'opacity-100 bg-green-100 border-green-200 text-green-600 hover:bg-green-200' : 'opacity-0 group-hover/row:opacity-100 bg-white/70 hover:bg-white text-[#A1887F] hover:text-[#3E2723] border-[#D7CCC8]'}`}
                                  title={isDone ? "Đã đánh dấu hoàn thành (Click để bỏ)" : "Đánh dấu hoàn thành"}
                               >
                                  <CheckCircle2 size={isFocusMode ? 14 : 12} />
                               </button>"""

text = text.replace(right_side_pattern, new_right_side)

with open('components/TranslationOutput.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
