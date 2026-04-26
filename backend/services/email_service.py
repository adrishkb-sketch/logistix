import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# Navigate up to find the .env file in the root directory
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env_path = os.path.join(base_dir, ".env")
print(f"DEBUG: Loading .env from {env_path}")
load_dotenv(env_path)

class EmailService:
    SMTP_SERVER = "smtp.gmail.com"
    SMTP_PORT = 587
    
    @staticmethod
    def send_otp_email(receiver_email, otp):
        sender_email = os.getenv("SMTP_EMAIL")
        sender_password = os.getenv("SMTP_PASSWORD")
        
        # Clean credentials to avoid common .env formatting issues
        if sender_email: sender_email = sender_email.strip().strip('"').strip("'")
        if sender_password: sender_password = sender_password.strip().strip('"').strip("'")
        
        print(f"DEBUG: Attempting to send email to {receiver_email} using {sender_email}")
        
        if not sender_email or not sender_password:
            print("ERROR: Email credentials missing or empty in .env")
            return False
            
        message = MIMEMultipart("alternative")
        message["Subject"] = f"Your Logistix Verification Code: {otp}"
        message["From"] = f"Logistix Platform <{sender_email}>"
        message["To"] = receiver_email
        
        # Premium HTML Email Template
        html = f"""
        <html>
        <body style="font-family: 'Inter', sans-serif; background-color: #0a0a0c; color: #ffffff; padding: 40px; text-align: center;">
            <div style="max-width: 500px; margin: 0 auto; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 40px; backdrop-filter: blur(20px);">
                <h1 style="color: #4f8cff; margin-bottom: 24px;">Logistix</h1>
                <p style="font-size: 16px; color: #a1a1aa; line-height: 1.6;">Use the verification code below to complete your sign-in. This code will expire in 10 minutes.</p>
                <div style="margin: 32px 0; padding: 20px; background: rgba(79, 140, 255, 0.1); border-radius: 12px; border: 1px dashed #4f8cff;">
                    <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #ffffff;">{otp}</span>
                </div>
                <p style="font-size: 14px; color: #71717a;">If you didn't request this, you can safely ignore this email.</p>
                <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 32px 0;">
                <p style="font-size: 12px; color: #52525b;">&copy; 2026 Logistix AI Solutions. All rights reserved.</p>
            </div>
        </body>
        </html>
        """
        
        message.attach(MIMEText(html, "html"))
        
        try:
            # Set a 15-second timeout for the connection
            with smtplib.SMTP(EmailService.SMTP_SERVER, EmailService.SMTP_PORT, timeout=15) as server:
                server.set_debuglevel(1) # Enable SMTP debug output to console
                server.starttls()
                server.login(sender_email, sender_password)
                server.sendmail(sender_email, receiver_email, message.as_string())
            print(f"SUCCESS: OTP Email sent to {receiver_email}")
            return True
        except smtplib.SMTPAuthenticationError:
            print("ERROR: Authentication failed. Please check your Gmail App Password.")
            return False
        except smtplib.SMTPConnectError:
            print("ERROR: Could not connect to Gmail SMTP server. Check your internet or firewall.")
            return False
        except Exception as e:
            print(f"CRITICAL ERROR sending email: {type(e).__name__}: {e}")
            return False
