import re

with open("components/DictionarySidebar.tsx", "r") as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    line = re.sub(r'onClick=\{([^\}]+?)\($', r'onClick={\1()}', line)
    line = re.sub(r'onClick=\{([^\}]+?)\((.*)$', r'onClick={\1(\2)}', line)
    
    line = re.sub(r'onChange=\{([^\}]+?)\($', r'onChange={\1()}', line)
    line = re.sub(r'onChange=\{([^\}]+?)\((.*)$', r'onChange={\1(\2)}', line)
    
    line = re.sub(r'onKeyDown=\{([^\}]+?)\($', r'onKeyDown={\1()}', line)
    line = re.sub(r'onKeyDown=\{([^\}]+?)\((.*)$', r'onKeyDown={\1(\2)}', line)
    
    new_lines.append(line)

with open("components/DictionarySidebar.tsx", "w") as f:
    f.writelines(new_lines)
