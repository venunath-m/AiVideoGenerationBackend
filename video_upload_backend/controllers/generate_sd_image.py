import sys
from diffusers import StableDiffusionPipeline
import torch

prompt = sys.argv[1]
output_path = sys.argv[2]

# CPU-only (your GT 610 cannot use CUDA)
pipe = StableDiffusionPipeline.from_pretrained(
    "runwayml/stable-diffusion-v1-5",
    torch_dtype=torch.float32
)
pipe = pipe.to("cpu")

image = pipe(prompt, num_inference_steps=25, guidance_scale=7.5).images[0]
image.save(output_path)
print("Image saved at", output_path)
