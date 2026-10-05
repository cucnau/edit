with open("components/DictionarySidebar.tsx", "r") as f:
    text = f.read()

text = text.replace('onClick={() => handlePullFromCloud(false disabled={', 'onClick={() => handlePullFromCloud(false)} disabled={')
text = text.replace('onClick={() => handlePushToCloud(false disabled={', 'onClick={() => handlePushToCloud(false)} disabled={')
text = text.replace('">)}', '">')
with open("components/DictionarySidebar.tsx", "w") as f:
    f.write(text)
