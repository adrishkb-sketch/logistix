import requests
import os
from dotenv import load_dotenv

# Load environment variables
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(base_dir, ".env"))

class WhatsAppService:
    @staticmethod
    def send_otp(phone_number, otp):
        """
        Sends an OTP via WhatsApp Cloud API.
        Meta requires using templates for business-initiated messages.
        For testing, we use the default 'hello_world' or a custom 'otp_template'.
        """
        token = os.getenv("WHATSAPP_TOKEN")
        phone_id = os.getenv("WHATSAPP_PHONE_ID")
        
        if not token or not phone_id:
            print("ERROR: WhatsApp credentials missing in .env")
            return False

        # Clean phone number: remove non-digits
        clean_phone = "".join(filter(str.isdigit, phone_number))
        # Ensure it has the country code (91 for India)
        if not clean_phone.startswith("91") and len(clean_phone) == 10:
            clean_phone = "91" + clean_phone
            
        # Use Meta API v18.0 (more stable than v17.0)
        url = f"https://graph.facebook.com/v18.0/{phone_id}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        # Meta requires using a pre-approved template.
        # We use a template structure that supports the OTP parameter.
        data = {
            "messaging_product": "whatsapp",
            "to": clean_phone,
            "type": "template",
            "template": {
                "name": "verification_code", # Optimized for standard OTP templates
                "language": { "code": "en_US" },
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {"type": "text", "text": otp}
                        ]
                    },
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": [
                            {"type": "text", "text": otp}
                        ]
                    }
                ]
            }
        }

        try:
            print(f"DEBUG: Attempting WhatsApp OTP Delivery to {clean_phone}...")
            response = requests.post(url, headers=headers, json=data)
            res_json = response.json()
            
            # Diagnostic check for Token Expiration (Error 190)
            if response.status_code == 401 or (res_json.get('error') and res_json['error'].get('code') == 190):
                print("🚨 CRITICAL: WhatsApp Access Token has EXPIRED. Please refresh WHATSAPP_TOKEN in .env")
                return False

            if response.status_code == 200:
                print(f"✅ WhatsApp OTP sent successfully to {clean_phone}")
                return True
            else:
                # If 'verification_code' fails, try the generic 'hello_world' as a last resort
                print(f"⚠️ Template 'verification_code' failed. Trying 'hello_world' fallback...")
                data["template"]["name"] = "hello_world"
                del data["template"]["components"]
                
                retry_res = requests.post(url, headers=headers, json=data)
                if retry_res.status_code == 200:
                    print(f"✅ Fallback 'hello_world' sent to {clean_phone}")
                    return True
                
                print(f"❌ WhatsApp API Error: {res_json}")
                return False
        except Exception as e:
            print(f"🔥 Critical Error in WhatsApp Service: {e}")
            return False
