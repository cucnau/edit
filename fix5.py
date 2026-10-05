with open("components/DictionarySidebar.tsx", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.strip() == ")":
        if "allCategories.map" in "".join(lines[max(0, i-5):i]):
            lines[i] = line.replace(")", "))}")
    elif line.strip() == "))":
        if "filteredTerms.map" in "".join(lines[max(0, i-40):i]):
            lines[i] = line.replace("))", "))}")

with open("components/DictionarySidebar.tsx", "w") as f:
    f.writelines(lines)
