with open("components/DictionarySidebar.tsx", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.strip() == "</button>" and i > 1 and "searchTerm && (" in "".join(lines[i-7:i]):
        lines[i] = "</button>\n          )}\n"
        
for i, line in enumerate(lines):
    if line.strip() == "))}":
        if "filteredTerms.map" in "".join(lines[max(0, i-60):i]):
            lines[i] = "              ))\n"

for i, line in enumerate(lines):
    if line.strip() == ")}":
        if "filteredTerms.length === 0" in "".join(lines[max(0, i-70):i]):
            lines[i] = "            )}\n"

with open("components/DictionarySidebar.tsx", "w") as f:
    f.writelines(lines)
