import requests
import urllib.parse

def translate(text, target_lang):
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={target_lang}&dt=t&q={urllib.parse.quote(text)}"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
    if r.status_code == 200:
        return r.json()[0][0][0]
    else:
        raise Exception(f"Translation failed: {r.status_code}")

print(translate("Return to the main overview screen", "ta"))
