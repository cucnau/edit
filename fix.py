with open("components/DictionarySidebar.tsx", "r") as f:
    content = f.read()

content = content.replace("onClick={() => setShowSettings(!showSettings", "onClick={() => setShowSettings(!showSettings)}")
content = content.replace("onKeyDown={(e) => e.key === 'Enter' && handleAdd(", "onKeyDown={(e) => e.key === 'Enter' && handleAdd()}")
with open("components/DictionarySidebar.tsx", "w") as f:
    f.write(content)
