import { createHash } from 'node:crypto';
import { PhotonImage } from '@silvia-odwyer/photon-node';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

/** Decode observations in the worker fault domain; retain only the recent bounded window. */
export function collectPiImages(content, previous = []) {
  const images = [...previous];
  for (const part of content ?? []) {
    if (part.type !== 'image') continue;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(part.mimeType) || typeof part.data !== 'string' || !part.data.length) throw new Error('Invalid Pi output image.');
    if (part.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('Pi output image exceeds the 8 MiB limit.');
    const id = `pi-image-${createHash('sha256').update(part.data).digest('hex')}`;
    const known = images.findIndex(image => image.id === id);
    if (known >= 0) {images.push(...images.splice(known,1)); continue;}
    const bytes = Buffer.from(part.data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Pi output image exceeds the 8 MiB limit.');
    let decoded, uniform = true, visible = false, width, height;
    try {
      decoded = PhotonImage.new_from_byteslice(bytes);
      width = decoded.get_width(); height = decoded.get_height();
      const pixels = decoded.get_raw_pixels();
      for (let offset = 0; offset < pixels.length; offset += 4) {
        visible ||= pixels[offset + 3] > 0;
        if (offset && (pixels[offset] !== pixels[0] || pixels[offset + 1] !== pixels[1] || pixels[offset + 2] !== pixels[2] || pixels[offset + 3] !== pixels[3])) uniform = false;
        if (visible && !uniform) break;
      }
    } catch {throw new Error('Cannot decode Pi output image.');}
    finally {decoded?.free();}
    images.push({id,type:'image',mimeType:part.mimeType,data:part.data,width,height,uniform,visible});
    while (images.length > 8 || images.reduce((sum,image)=>sum+Buffer.byteLength(image.data,'base64'),0)>MAX_TOTAL_BYTES) images.shift();
  }
  return images;
}

/** Selection is separate from observation. No observed image is implicitly published. */
export function selectPiImages(observations, ids, purpose = 'image') {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || !['image','screenshot'].includes(purpose)) throw new Error('Select 1–8 current image ids and a valid purpose.');
  return [...new Set(ids)].map(id => {
    const image = observations.find(candidate => candidate.id === id);
    if (!image) throw new Error('This image is no longer in the observation cache. Capture or read the intended image again before selecting it.');
    if (purpose === 'screenshot' && (image.uniform || !image.visible)) throw new Error('The selected screenshot is blank or transparent. Its target window is unverified; inspect the window and capture again.');
    return image;
  });
}
