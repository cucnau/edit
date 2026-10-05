import re

with open("components/TranslationOutput.tsx", "r") as f:
    text = f.read()

old_func = """  const handleVocabClick = (event: React.MouseEvent, vocab: VocabItem, type: 'char' | 'custom' | 'ai' = 'ai') => {
     event.stopPropagation();"""

new_func = """  const handleVocabClick = (event: React.MouseEvent, vocab: VocabItem, type: 'char' | 'custom' | 'ai' = 'ai') => {
     const selection = window.getSelection();
     if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
       // Ignore click if the user is currently selecting text
       return;
     }

     event.stopPropagation();"""

text = text.replace(old_func, new_func)

with open("components/TranslationOutput.tsx", "w") as f:
    f.write(text)
