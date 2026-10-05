import re

with open("components/DictionarySidebar.tsx", "r") as f:
    text = f.read()

# Fix the double closing from previous script
text = text.replace("onClick={() => setShowSettings(true)})}", "onClick={() => setShowSettings(true)}")
text = text.replace("onClick={() => setShowSettings(!showSettings)})}", "onClick={() => setShowSettings(!showSettings)}")
text = text.replace("onClick={() => fileInputRef.current?.click()})}", "onClick={() => fileInputRef.current?.click()}")
text = text.replace("onClick={() => setAutoSync(!autoSync)}", "onClick={() => setAutoSync(!autoSync)}") # Wait, this one is ok
text = text.replace("${vpCount.toLocaleString( từ`", "${vpCount.toLocaleString()} từ`")
text = text.replace("onClick={() => {", "onClick={() => {") # No-op

# Also there was missing ) for some things
text = text.replace("onClick={() => setAutoSync(!autoSync)()}", "onClick={() => setAutoSync(!autoSync)}")
text = text.replace("onChange={(e) => setBulkText(e.target.value)()}", "onChange={(e) => setBulkText(e.target.value)}")
text = text.replace("onChange={(e) => setSearchTerm(e.target.value)()}", "onChange={(e) => setSearchTerm(e.target.value)}")
text = text.replace("onClick={() => setSearchTerm(''()}", "onClick={() => setSearchTerm('')}")
text = text.replace("onClick={() => handleDelete(item.id)()}", "onClick={() => handleDelete(item.id)}")
text = text.replace("onChange={(e) => setNewTerm(e.target.value)()}", "onChange={(e) => setNewTerm(e.target.value)}")
text = text.replace("onChange={(e) => setNewMeaning(e.target.value)()}", "onChange={(e) => setNewMeaning(e.target.value)}")

# onKeyDown
text = text.replace("onKeyDown={(e) => e.key === 'Enter' && handleAdd()})}", "onKeyDown={(e) => e.key === 'Enter' && handleAdd()}")

with open("components/DictionarySidebar.tsx", "w") as f:
    f.write(text)
