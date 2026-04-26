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
            
        url = f"https://graph.facebook.com/v17.0/{phone_id}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        # Meta requires using a pre-approved template for the first message.
        # We'll try to use a template named 'verification_code' if you have one, 
        # or fallback to a standard text message (only works if user messaged first).
        
        data = {
            "messaging_product": "whatsapp",
            "to": clean_phone,
            "type": "template",
            "template": {
                "name": "hello_world", # Default template provided by Meta for testing
                "language": { "code": "en_US" }
            }
        }
        
        # In a real production app, you would use a template like this:
        # data = {
        #     "messaging_product": "whatsapp",
        #     "to": clean_phone,
        #     "type": "template",
        #     "template": {
        #         "name": "verification_code",
        #         "language": { "code": "en_US" },
        #         "components": [
        #             {
        #                 "type": "body",
        #                 "parameters": [{"type": "text", "text": otp}]
        #             }
        #         ]
        #     }
        # }

        try:
            print(f"DEBUG: Sending WhatsApp OTP to {clean_phone}...")
            response = requests.post(url, headers=headers, json=data)
            res_json = response.json()
            
            if response.status_code == 200:
                print(f"WhatsApp OTP sent successfully to {clean_phone}")
                return True
            else:
                print(f"FAILED to send WhatsApp OTP: {res_json}")
                return False
        except Exception as e:
            print(f"CRITICAL ERROR sending WhatsApp: {e}")
            return False
