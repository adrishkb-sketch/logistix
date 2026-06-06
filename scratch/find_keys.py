import json

with open("/Users/adrish/Desktop/Projects/logistix/frontend/js/en.json", "r") as f:
    data = json.load(f)

voice_keys = {k: v for k, v in data.items() if k.startswith("voice_instr_")}
for k, v in sorted(voice_keys.items()):
    print(f'"{k}": "{v}",')
