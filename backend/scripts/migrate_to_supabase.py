import os
import json
import uuid
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("Error: SUPABASE_URL or SUPABASE_KEY is missing from .env file.")
    exit(1)

supabase: Client = create_client(url, key)

base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
data_dir = os.path.join(base_dir, "data")

def migrate():
    print("Starting migration to Supabase...")
    
    # Upload Images
    images_dir = os.path.join(data_dir, "images")
    if os.path.exists(images_dir):
        print("Uploading local images to Supabase Storage ('logistix-assets' bucket)...")
        for img in os.listdir(images_dir):
            img_path = os.path.join(images_dir, img)
            if os.path.isfile(img_path):
                with open(img_path, "rb") as f:
                    try:
                        # Supabase doesn't upsert files natively in upload(), 
                        # so if it exists it might throw. We can ignore or catch.
                        supabase.storage.from_("logistix-assets").upload(
                            file=f,
                            path=img,
                            file_options={"upsert": "true"}
                        )
                        print(f"Uploaded: {img}")
                    except Exception as e:
                        print(f"Skipped/Error uploading {img}: {e}")
                        
    # Migrate Database Tables
    for filename in os.listdir(data_dir):
        if filename.endswith(".json"):
            table_name = filename.replace(".json", "")
            file_path = os.path.join(data_dir, filename)
            
            with open(file_path, "r") as f:
                try:
                    data_list = json.load(f)
                except Exception:
                    data_list = []
                    
            if not data_list:
                print(f"Skipping {table_name}: Empty or invalid JSON.")
                continue
                
            print(f"Migrating {len(data_list)} records to {table_name}...")
            
            # Insert into Supabase
            for item in data_list:
                # Ensure an ID exists
                if "id" not in item:
                    item["id"] = str(uuid.uuid4())
                
                # Update image paths to public URLs if applicable
                if table_name == "drivers" and item.get("verification_image"):
                    img_name = item["verification_image"]
                    if not img_name.startswith("http"):
                        public_url = supabase.storage.from_("logistix-assets").get_public_url(img_name)
                        item["verification_image"] = public_url

                # Push the exact JSON object into the 'data' JSONB column
                record = {
                    "id": str(item["id"]),
                    "data": item
                }
                
                try:
                    # Upsert (insert or update) based on primary key 'id'
                    supabase.table(table_name).upsert(record).execute()
                except Exception as e:
                    print(f"Error migrating item {item['id']} in {table_name}: {e}")
                    
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
