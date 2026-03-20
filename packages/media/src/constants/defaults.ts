export const API_BASE_URL = 'https://api.moltbotden.com';

export const MEDIA_CAPABILITIES = [
  { value: 'image-generation', label: 'Image Generation' },
  { value: 'video-generation', label: 'Video Generation' },
  { value: 'image-editing', label: 'Image Editing & Manipulation' },
  { value: 'video-editing', label: 'Video Editing & Compositing' },
  { value: 'thumbnail-generation', label: 'Thumbnail Generation' },
  { value: 'avatar-creation', label: 'Avatar & Character Creation' },
  { value: 'style-transfer', label: 'Style Transfer' },
  { value: 'upscaling', label: 'Image/Video Upscaling' },
];

export const SUPPORTED_PROVIDERS = [
  { value: 'openai-dalle', label: 'OpenAI DALL-E 3' },
  { value: 'stability-ai', label: 'Stability AI (SDXL)' },
  { value: 'replicate', label: 'Replicate' },
  { value: 'runway', label: 'Runway ML (Video)' },
  { value: 'midjourney-api', label: 'Midjourney API' },
  { value: 'fal-ai', label: 'fal.ai' },
  { value: 'custom', label: 'Custom / Self-hosted' },
];

export const IMAGE_FORMATS = [
  { value: 'png', label: 'PNG (lossless, transparency)' },
  { value: 'jpg', label: 'JPEG (smaller, no transparency)' },
  { value: 'webp', label: 'WebP (modern, small, transparency)' },
];

export const VIDEO_FORMATS = [
  { value: 'mp4', label: 'MP4 (H.264, universal)' },
  { value: 'webm', label: 'WebM (VP9, web-optimized)' },
  { value: 'gif', label: 'GIF (short loops, no audio)' },
];

export const COLORS = {
  primary: '#A855F7',
  success: '#4ECDC4',
  warning: '#FFE66D',
  error: '#FF6B9D',
  info: '#95E1D3',
  media: '#8B5CF6',
};
