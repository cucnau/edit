import re

with open("components/DictionarySidebar.tsx", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    # Fix common onClick={() => something(arg
    if re.search(r'onClick=\{[^\}]+$', line):
        print(f"Line {i+1}: {line.strip()}")
    if re.search(r'onChange=\{[^\}]+$', line):
        print(f"Line {i+1}: {line.strip()}")
