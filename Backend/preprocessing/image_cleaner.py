import requests
from PIL import Image
from io import BytesIO
import numpy as np

def prepare_thumbnail(url: str, target_size=(224, 224)):
    """
    Downloads, resizes, and normalizes a thumbnail image for CNN analysis.
    """
    try:
        # 1. Download the image
        response = requests.get(url, timeout=10)
        response.raise_for_status() # Check if download was successful
        
        img = Image.open(BytesIO(response.content))
        
        # 2. Convert to RGB (removes alpha channel if PNG)
        if img.mode != 'RGB':
            img = img.convert('RGB')
            
        # 3. Resize for the Model (ResNet-50 standard is 224x224)
        img = img.resize(target_size)
        
        # 4. Conversion to Array & Normalization (Crucial for ML)
        # Converts pixels from 0-255 to 0.0-1.0
        img_array = np.array(img) / 255.0
        
        return {
            "status": "Success",
            "shape": img_array.shape,
            "message": f"Image prepared at {target_size}"
        }

    except requests.exceptions.RequestException as e:
        return {"status": "Error", "message": f"Download failed: {str(e)}"}
    except Exception as e:
        return {"status": "Error", "message": f"Processing failed: {str(e)}"}