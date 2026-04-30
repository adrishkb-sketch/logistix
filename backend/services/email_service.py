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
    def send_otp_email(receiver_email, otp, purpose="general", context=None):
        sender_email = os.getenv("SMTP_EMAIL")
        sender_password = os.getenv("SMTP_PASSWORD")
        
        if sender_email: sender_email = sender_email.strip().strip('"').strip("'")
        if sender_password: sender_password = sender_password.strip().strip('"').strip("'")
        
        if not sender_email or not sender_password:
            return False
            
        message = MIMEMultipart("alternative")
        
        # Context-aware Subject and Content
        subject = f"Your Logistix Verification Code: {otp}"
        header_title = "Verification Code"
        description = "Use the verification code below to complete your action."
        footer_note = "If you didn't request this, you can safely ignore this email."

        if purpose == "registration":
            company_name = context if context else "your company"
            subject = f"OTP for Registration of {company_name}"
            header_title = "Company Registration"
            description = f"Please use this OTP to complete the registration of <b>{company_name}</b> on the Logistix Platform."
        elif purpose == "deletion":
            subject = "URGENT: OTP for Account Deletion"
            header_title = "Account Deletion"
            description = "You have requested to <b>permanently delete</b> your Logistix company account. This action cannot be undone."
            footer_note = "If you did not request this, please change your password immediately."
        elif purpose == "tracking":
            subject = "Logistix: OTP for Order Tracking"
            header_title = "Track Your Order"
            description = "Enter this code to access your live shipment tracking dashboard."

        message["Subject"] = subject
        message["From"] = f"Logistix Platform <{sender_email}>"
        message["To"] = receiver_email
        
        # Premium HTML Email Template
        html = f"""
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap');
            </style>
        </head>
        <body style="font-family: 'Outfit', sans-serif; background-color: #050505; color: #ffffff; padding: 40px; text-align: center;">
            <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(145deg, #0f0f12, #08080a); border: 1px solid rgba(79, 140, 255, 0.2); border-radius: 24px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                <div style="margin-bottom: 30px;">
                    <span style="font-size: 28px; font-weight: 800; color: #4f8cff; letter-spacing: -1px;">LOGISTIX</span>
                </div>
                <h2 style="color: #ffffff; margin-bottom: 16px; font-size: 22px;">{header_title}</h2>
                <p style="font-size: 16px; color: #a1a1aa; line-height: 1.6; margin-bottom: 32px;">{description}</p>
                
                <div style="margin: 32px 0; padding: 24px; background: rgba(79, 140, 255, 0.05); border-radius: 16px; border: 1px dashed rgba(79, 140, 255, 0.4);">
                    <span style="font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #4f8cff; text-shadow: 0 0 20px rgba(79, 140, 255, 0.3);">{otp}</span>
                </div>
                
                <p style="font-size: 14px; color: #71717a; margin-top: 32px;">{footer_note}</p>
                
                <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.05); margin: 32px 0;">
                <p style="font-size: 12px; color: #52525b; letter-spacing: 1px; text-transform: uppercase;">&copy; 2026 Logistix AI Solutions</p>
            </div>
        </body>
        </html>
        """
        
        message.attach(MIMEText(html, "html"))
        
        try:
            with smtplib.SMTP(EmailService.SMTP_SERVER, EmailService.SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(sender_email, sender_password)
                server.sendmail(sender_email, receiver_email, message.as_string())
            return True
        except Exception:
            return False
    @staticmethod
    def send_goodbye_email(receiver_email, company_name):
        sender_email = os.getenv("SMTP_EMAIL")
        sender_password = os.getenv("SMTP_PASSWORD")
        
        if sender_email: sender_email = sender_email.strip().strip('"').strip("'")
        if sender_password: sender_password = sender_password.strip().strip('"').strip("'")
        
        if not sender_email or not sender_password:
            return False
            
        message = MIMEMultipart("alternative")
        message["Subject"] = "Account Deleted: Sorry to see you go"
        message["From"] = f"Logistix Platform <{sender_email}>"
        message["To"] = receiver_email
        
        html = f"""
        <html>
        <body style="font-family: 'Outfit', sans-serif; background-color: #050505; color: #ffffff; padding: 40px; text-align: center;">
            <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(145deg, #0f0f12, #08080a); border: 1px solid rgba(255, 79, 79, 0.2); border-radius: 24px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                <div style="margin-bottom: 30px;">
                    <span style="font-size: 28px; font-weight: 800; color: #ff4f4f; letter-spacing: -1px;">LOGISTIX</span>
                </div>
                <h2 style="color: #ffffff; margin-bottom: 16px; font-size: 22px;">Account Successfully Deleted</h2>
                <p style="font-size: 16px; color: #a1a1aa; line-height: 1.6; margin-bottom: 32px;">
                    This is to confirm that the Logistix account for <b>{company_name}</b> and all associated data have been permanently removed from our systems.
                </p>
                <div style="margin: 32px 0; padding: 20px; background: rgba(255, 79, 79, 0.05); border-radius: 16px; border: 1px solid rgba(255, 79, 79, 0.2);">
                    <span style="font-size: 20px; font-weight: 700; color: #ff4f4f;">Sorry to see you go!</span>
                </div>
                <p style="font-size: 14px; color: #71717a; margin-top: 32px;">
                    We hope to work with you again in the future. Thank you for using Logistix.
                </p>
                <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.05); margin: 32px 0;">
                <p style="font-size: 12px; color: #52525b; letter-spacing: 1px; text-transform: uppercase;">&copy; 2026 Logistix AI Solutions</p>
            </div>
        </body>
        </html>
        """
        
        message.attach(MIMEText(html, "html"))
        
        try:
            with smtplib.SMTP(EmailService.SMTP_SERVER, EmailService.SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(sender_email, sender_password)
                server.sendmail(sender_email, receiver_email, message.as_string())
            return True
        except Exception:
            return False

    @staticmethod
    def send_welcome_email(receiver_email, company_name, company_id, password):
        sender_email = os.getenv("SMTP_EMAIL")
        sender_password = os.getenv("SMTP_PASSWORD")
        
        if sender_email: sender_email = sender_email.strip().strip('"').strip("'")
        if sender_password: sender_password = sender_password.strip().strip('"').strip("'")
        
        if not sender_email or not sender_password:
            return False
            
        message = MIMEMultipart("alternative")
        message["Subject"] = f"Welcome to Logistix, {company_name}! 🚀"
        message["From"] = f"Logistix Platform <{sender_email}>"
        message["To"] = receiver_email
        
        html = f"""
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap');
            </style>
        </head>
        <body style="font-family: 'Outfit', sans-serif; background-color: #050505; color: #ffffff; padding: 20px; text-align: center;">
            <div style="max-width: 600px; margin: 0 auto; background: #0f0f12; border: 1px solid rgba(79, 140, 255, 0.2); border-radius: 24px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); text-align: left;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <span style="font-size: 32px; font-weight: 800; color: #4f8cff; letter-spacing: -1px;">LOGISTIX</span>
                    <p style="color: #a1a1aa; font-size: 18px; margin-top: 10px;">Your Smart Logistics Journey Begins Here</p>
                </div>
                
                <h2 style="color: #ffffff; font-size: 24px; border-left: 4px solid #4f8cff; padding-left: 15px; margin-bottom: 20px;">Welcome Aboard!</h2>
                <p style="font-size: 16px; color: #d1d1d6; line-height: 1.6;">
                    Hello <b>{company_name}</b>, thank you for joining the Logistix platform. We're excited to help you optimize your fleet and scale your operations with AI-driven precision.
                </p>
                
                <div style="background: rgba(79, 140, 255, 0.05); border-radius: 16px; padding: 25px; margin: 30px 0; border: 1px solid rgba(79, 140, 255, 0.1);">
                    <h3 style="color: #4f8cff; margin-top: 0; font-size: 18px;">🔐 Your Manager Credentials</h3>
                    <table style="width: 100%; color: #d1d1d6; font-size: 15px; border-collapse: collapse;">
                        <tr><td style="padding: 8px 0; font-weight: bold;">Manager Email:</td><td style="padding: 8px 0;">{receiver_email}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Password:</td><td style="padding: 8px 0; color: #ffffff;">{password}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Company ID:</td><td style="padding: 8px 0; font-family: monospace; color: #4f8cff;">{company_id}</td></tr>
                    </table>
                    <p style="font-size: 12px; color: #71717a; margin-top: 15px;">* Please share the <b>Company ID</b> with your drivers so they can link their apps to your fleet.</p>
                </div>
                
                <h3 style="color: #ffffff; font-size: 20px; margin-bottom: 15px;">✨ Platform Capabilities</h3>
                <ul style="color: #a1a1aa; font-size: 15px; line-height: 1.8; padding-left: 20px;">
                    <li><b>Digital Twin Strategy:</b> Simulate growth scenarios and predict disruptions before they happen.</li>
                    <li><b>Smart Dispatch:</b> Automated driver-vehicle linking based on performance and proximity.</li>
                    <li><b>Fintech Oracle:</b> Real-time digital escrow and cashless refuel fund management.</li>
                    <li><b>Safety Center:</b> Monitor driver vitals and fatigue levels via wearable integration.</li>
                    <li><b>Cold Chain IQ:</b> AI-monitored vitality tracking for perishable shipments.</li>
                </ul>
                
                <div style="text-align: center; margin-top: 40px;">
                    <a href="http://localhost:8000" style="background: #4f8cff; color: #ffffff; padding: 15px 35px; border-radius: 30px; text-decoration: none; font-weight: bold; font-size: 16px; box-shadow: 0 10px 20px rgba(79, 140, 255, 0.3);">Go to Dashboard</a>
                </div>
                
                <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.05); margin: 40px 0;">
                <p style="font-size: 12px; color: #52525b; text-align: center; letter-spacing: 1px; text-transform: uppercase;">&copy; 2026 Logistix AI Solutions | Powered by Advanced Agentic Intelligence</p>
            </div>
        </body>
        </html>
        """
        
        message.attach(MIMEText(html, "html"))
        
        try:
            with smtplib.SMTP(EmailService.SMTP_SERVER, EmailService.SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(sender_email, sender_password)
                server.sendmail(sender_email, receiver_email, message.as_string())
            return True
        except Exception:
            return False
