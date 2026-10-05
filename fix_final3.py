with open("components/DictionarySidebar.tsx", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.strip() == "))":
        if "<option key={cat}" in lines[i-1]:
            lines[i] = line.replace("))", "))}")

with open("components/DictionarySidebar.tsx", "w") as f:
    f.writelines(lines)
